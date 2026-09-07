#!/usr/bin/env node
/**
 * Run the Supabase CLI as *this repo's* account, whatever you are globally
 * logged into.
 *
 *   npm run supabase -- projects list
 *   npm run supabase -- functions deploy market-data
 *   npm run supabase:whoami
 *
 * ## Why this exists
 *
 * `supabase login` stores one access token for the whole machine. Working
 * across several Supabase accounts, whichever you logged into last wins — and
 * nothing tells you which that is. The failure mode is not an error message;
 * it is a migration applied to the wrong company's database.
 *
 * So: a per-repo token in the gitignored `.env` as SUPABASE_ACCESS_TOKEN, which
 * the CLI honours over the global login, and a check before every command that
 * the token can actually see the projects in supabase/projects.json.
 *
 * Being pointed at the wrong account now fails loudly, before the command runs,
 * instead of succeeding against the wrong database.
 *
 * Dependency-free: Node built-ins, and the CLI you already have.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function fail(message, hint) {
  console.error(`\n  ✗ ${message}\n`)
  if (hint) console.error(`${hint}\n`)
  process.exit(1)
}

// --- the token, from .env rather than the machine-wide login -----------------

function tokenFromEnv() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN
  const path = join(ROOT, '.env')
  if (!existsSync(path)) return null
  const m = readFileSync(path, 'utf8').match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)
  return m ? m[1].trim() : null
}

const token = tokenFromEnv()
if (!token) {
  fail(
    'SUPABASE_ACCESS_TOKEN is not set in .env',
    `  This repo does not use the machine-wide 'supabase login', so that commands
  here always run against the right account.

  1. Sign in to supabase.com as the account that owns this project
  2. https://supabase.com/dashboard/account/tokens -> Generate new token
  3. Add to .env:   SUPABASE_ACCESS_TOKEN=sbp_...`
  )
}

// --- what this repo expects to see ------------------------------------------

const manifestPath = join(ROOT, 'supabase', 'projects.json')
if (!existsSync(manifestPath)) fail('supabase/projects.json is missing — cannot verify which account this repo belongs to')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const expected = Object.entries(manifest.projects).map(([env, p]) => ({ env, ...p }))

// --- verify before running anything -----------------------------------------

async function verify() {
  const res = await fetch('https://api.supabase.com/v1/projects', { headers: { Authorization: `Bearer ${token}` } })

  if (res.status === 401) {
    fail(
      'Supabase rejected the token in .env (401)',
      '  It may have been revoked, or copied incompletely. Generate a new one at\n  https://supabase.com/dashboard/account/tokens'
    )
  }
  if (!res.ok) fail(`Could not reach the Supabase management API (HTTP ${res.status})`)

  const visible = await res.json()
  const refs = new Set(visible.map(p => p.ref))
  const missing = expected.filter(p => !refs.has(p.ref))

  if (missing.length > 0) {
    const sample = visible
      .slice(0, 6)
      .map(p => `      ${p.name}  (${p.ref})`)
      .join('\n')
    fail(
      `The token in .env cannot see this repo's projects — it belongs to a different account`,
      `  Expected (per supabase/projects.json, account ${manifest.account}):
${missing.map(p => `      ${p.name}  (${p.ref})`).join('\n')}

  This token can see:
${sample || '      (no projects)'}

  Generate a token from the account that owns these projects and replace
  SUPABASE_ACCESS_TOKEN in .env.`
    )
  }

  return { visible, expected }
}

// --- commands ----------------------------------------------------------------

const args = process.argv.slice(2)

if (args[0] === '--whoami' || args.length === 0) {
  const { visible } = await verify()
  console.log('')
  console.log(`  account       ${manifest.account}`)
  console.log(`  organization  ${manifest.organization}`)
  console.log('')
  for (const p of expected) {
    const live = visible.find(v => v.ref === p.ref)
    console.log(`  ${p.env.padEnd(5)} ${p.name.padEnd(16)} ${p.ref}  ${live ? live.status : 'not visible'}`)
  }
  console.log('')
  console.log('  Token verified against these projects. CLI commands from this repo')
  console.log('  will use it regardless of the machine-wide supabase login.')
  console.log('')
} else {

  await verify()

  // Pass everything through, with the repo's token in the environment.
  //
  // Invoke the shell explicitly rather than using spawn(cmd, args, {shell:true}).
  // Node deprecated that combination because a shell concatenates the args array
  // instead of escaping it, so an argument containing shell syntax gets executed.
  // A shell is still needed on Windows (npx is a .cmd), so we build one command
  // string and quote every argument ourselves.
  const quote = a => {
    const s = String(a)
    if (/^[\w.@/:=-]+$/.test(s)) return s
    // Inside double quotes a POSIX shell still expands $, `, \ and ".
    return `"${s.replace(/(["\\$`])/g, '\\$1')}"`
  }
  const command = ['npx', '--yes', 'supabase', ...args].map(quote).join(' ')

  const [shellPath, shellArgs] =
    process.platform === 'win32'
      ? [process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command]]
      : ['/bin/sh', ['-c', command]]

  const child = spawn(shellPath, shellArgs, {
    stdio: 'inherit',
    env: { ...process.env, SUPABASE_ACCESS_TOKEN: token },
  })
  child.on('exit', code => {
    process.exitCode = code ?? 0
  })
}

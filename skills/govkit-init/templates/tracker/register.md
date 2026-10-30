This issue is the **decision register**: everything only an owner can do or decide. It stays open and pinned. Agents add to it; owners decide. govkit's status report reads the two tables below, under these exact headings, every run, so keep the headings as they are.

### Things only an owner can do
| # | Action | Why it matters | Blocks |
|---|--------|----------------|--------|

### Open decisions
| ID | Question | Decide by | Recommendation |
|----|----------|-----------|----------------|

### Decided
| ID | Question | Decided on | Answer |
|----|----------|------------|--------|

---

**Rules for agents** (from govkit's tracker module):
- A question engineering can't answer (pricing, policy, legal posture, a promise to customers, brand terms, vendor choice) goes in **Open decisions** as `D-###`, and the issue it came from gets the `needs-decision` label.
- **Never invent an owner's answer to keep moving.** Write the assumption down here, build under it, and say so in the session summary.
- Make each `D-###` ready to decide:
  1. **Options:** the real choices, including what the code does today.
  2. **Industry practice:** with links you checked, never from memory.
  3. **Legal or compliance:** what applies, and whether a lawyer is needed.
  4. **Recommendation and confidence.**
  5. **Decide by:** the event it blocks.
- When an owner decides, move the row to **Decided** with the date and the answer. Keep the history.

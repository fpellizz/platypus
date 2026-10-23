# Platypus 2.9 development loop for Claude Code

This file makes Claude Code work through the plan `docs/plans/2.9-map-and-territory.md`, one task at a time, until the plan is finished or until a decision of yours is needed.

## How to start (for Max)

1. Open Claude Code in the `platypus` repository folder, after publishing it with `PASSAGGIO-A-CLAUDE-CODE.md`.
2. Put `PIANO-2.9.md` and this file in a folder Claude Code can read (for example `~/Downloads`).
3. Paste the **setup prompt** below. This is done only once.
4. Then start the loop with the command in the **Starting the loop** section.
5. To stop it at any time: `Esc`, or write "stop". The work done stays in the commits and in the plan's Journal. To resume, run the same command again.

---

## Setup prompt (only once)

```
Let's prepare the development of Platypus 2.9.

1. Find PIANO-2.9.md and LOOP-PLATYPUS-2.9.md (they should be in ~/Downloads; if you can't find them, ask me where they are).
2. Check that the tree is clean (git status) and that `git config user.email` is NOT an @decisyon.com address. If it is, stop and ask me which one to use.
3. Create the `sviluppo-2.9` branch from main and switch to it.
4. Copy the two files into the repository:
   - PIANO-2.9.md → docs/plans/2.9-map-and-territory.md
   - LOOP-PLATYPUS-2.9.md → docs/plans/LOOP-2.9.md
5. Read the plan, README.md and docs/ARCHITECTURE.md. Run `npm test` and `npm run i18n:check` to get the starting point: they must be green. If they aren't, tell me before doing anything else.
6. Make a commit "Add the 2.9 development plan".
7. Tell me in three lines whether the plan is clear to you and whether you see problems or tasks to split. Don't start writing code yet.
```

---

## Starting the loop

If your version of Claude Code has the `/loop` command, use this line (no interval: it sets its own pace):

```
/loop Follow docs/plans/LOOP-2.9.md, section "Instructions for each iteration": run ONE iteration on the plan docs/plans/2.9-map-and-territory.md.
```

If there is no `/loop`, paste this text into a normal session:

```
Follow docs/plans/LOOP-2.9.md, section "Instructions for each iteration". Repeat the iterations one after another, without asking me for confirmation between tasks, until one of the stop conditions is met.
```

---

## Instructions for each iteration

The state of the work isn't in your memory, which can be compacted. It is in three places: the plan's checkboxes, the **Journal** at the bottom of the plan, and `git log`. Always reread them at the start.

### 1. Get your bearings

- `git status` and `git branch --show-current`: you must be on `sviluppo-2.9`.
- If the tree isn't clean, a previous iteration was interrupted:
  - look in the plan for the task marked `[~]` (in progress) and the last Journal entry;
  - review the diff and decide whether to finish it or, if it's a mess, start over with `git stash`;
  - write the choice in the Journal.
- Open `docs/plans/2.9-map-and-territory.md`:
  - reread the "Project rules";
  - find the **first** task marked `[ ]` in the order A1 → A5, B1 → B5, C1 → C5, D1 → D2.
- If there are none left, go to the **Stop conditions**.

### 2. Prepare the task

- Mark the task's title with `[~]`.
- Read the task's description and the code listed in the "map of the existing code".
- Also read the Journal entries of the tasks it depends on.
- If the task is too big for one iteration, split it:
  - write the sub-steps in the Journal;
  - make one commit per sub-step, with a message starting with the identifier, for example "A3 (1/2): …";
  - leave `[~]` until they are all done.

### 3. Implement

- Follow the Project rules, in particular:
  - no npm packages in the engine;
  - `tr()`/`trn()` for strings, with the English translations in `src/i18n/locales/en/` (the new file is `grounding.json`);
  - lazy disk checks with a cache;
  - every analysis inside `try/catch`;
  - in the interface, honesty about what is measured and what is likely.
- Every feature must be visible in the demo.
- Every new parser has its own tests: they go in `scripts/smoke-test.js`, or in `scripts/unit-test.js` called by `npm test`.
- Don't touch files that aren't involved. Don't reformat existing code.

### 4. Verify

Always:

- `npm test` must end with "Tutto a posto.";
- `npm run i18n:check` must not report missing strings.

When needed, also:

- try the new APIs on the demo in browser mode:
  - start `node src/standalone.js --demo --no-open` (or the equivalent in `package.json`) in the background;
  - query the endpoints with `curl` or `node -e`;
  - then close the process.
- If the task touches the interface and the computer has a screen, take a screenshot with the Electron window and the demo, using the `PLATYPUS_SNAPSHOT`, `PLATYPUS_SNAPSHOT_JS` and `PLATYPUS_SNAPSHOT_DELAY` variables (see `src/main.js`).
  - Look at the screenshot to check there are no overlaps, cut-off text or empty areas.
  - Save it outside the repository, except the ones required by D1.
- If a check fails:
  - fix it and try again;
  - after three failed attempts on the same problem, mark the task `[!]` with the reason and move on to the next one, if it doesn't depend on this one.

### 5. Close

- Mark the task `[x]`, or `[!]` with a line "Blocked: …" below it.
- Add an entry to the Journal, in English:
  ```
  ### <date> · <ID> <title>
  - Done: …
  - Verified: … (commands and results)
  - Decisions: … (non-obvious choices, thresholds, things postponed)
  - Questions for Max: … (if any)
  ```
- Commit, one per task: message in English in the imperative mood with the identifier, for example "A1: detect stale memories against file mtimes", plus the attribution lines you usually use.
- **Never `git push`.** Never merge into main.

### 6. Continue or stop

- If no stop condition has been met, move on to the next task:
  - with `/loop`: schedule the next iteration with the minimum delay;
  - without: carry on straight away.
- Every **five tasks closed**, write me a three-line summary, without stopping: what is done, what is blocked, what comes next.

---

## Stop conditions

Stop, end the loop and write me a short message, in Italian, when:

1. **The plan is finished:** every task is `[x]` or `[!]`. Tell me:
   - what is blocked and why;
   - the known limits, taken from the Journal;
   - the command to try it: `npm run start:demo`.
2. **A decision or permission of mine is needed,** for example:
   - a product choice the plan doesn't settle and that would change the work a lot;
   - reading my real Claude Code sessions in `~/.claude` (in D2);
   - any write outside the repository and `~/.platypus`.
3. **`npm test` was green and you can't get it green again** after the attempts in point 4.
4. **You are about to do something from the "Never" list** below.

## Never, under any circumstances

- `git push`, opening pull requests, merging into main, rewriting commits already made.
- `npm run hooks:install`, or changing `~/.claude/settings.json`.
- Writing a `CLAUDE.md` in a real project. In C4 the export is tested only in a temporary folder created for the purpose.
- Adding npm dependencies to the engine, or any new network call.
- Putting data from my real sessions into the repository: transcripts, paths, contents.
- Using the @decisyon.com address as the commit author.

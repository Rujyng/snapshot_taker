# Research Code Snapshots

An offline VS Code extension for collecting source-code history during a research
session. It reads the actual editor buffers, including unsaved text, incomplete
expressions, whitespace and errors. It does not change, save, execute or correct
the participant's code. No account, server, Python or separate Node installation
is needed on the experiment computer.

## Tomorrow's setup

1. Copy `research-code-snapshots-1.0.0.vsix` to Google Drive or a USB drive.
2. At school, download it to a local folder. Open desktop VS Code.
3. Press **Ctrl+Shift+P** → **Extensions: Install from VSIX…** → select the file.
   Accept the local publisher only after checking that it is the installer you
   transferred. Reload VS Code if prompted. The school must allow extensions.
4. Open **only the experiment task folder** using **File → Open Folder**. Use a
   local window, not a WSL/SSH/container window. Close unrelated editor tabs.
5. Press **Ctrl+Shift+P** → **Code Snapshots: Start Recording**. Enter an anonymous
   participant ID, such as `P01`, and choose an output folder outside the task
   folder. Check that the status bar says **Snapshots: P01**.
6. Start Tobii recording. Run **Code Snapshots: Add Sync Marker** while the VS Code
   screen is visible in the recording. This displays a numbered notification and
   records its command time. Add another marker near the end if useful.
7. After the task, run **Code Snapshots: Stop Recording**. Use **Code Snapshots:
   Open Output Folder** and copy the **entire session folder** to your study
   storage. Start a new recording for each participant; folders are never reused.

**Do a short rehearsal before the participant arrives:** start a `TEST` session,
type some deliberately unfinished code without saving, wait at least 12 seconds,
delete and undo something, then stop. Open the session's `current` and `snapshots`
folders and confirm that the unsaved text was captured. Remove only the test
session afterward. This rehearsal is necessary because school extension policies
and the real desktop environment can differ from development tests.

Official installation instructions:
<https://code.visualstudio.com/docs/configure/extensions/extension-marketplace#_install-from-a-vsix>

## What is captured

- A baseline when a document is first encountered, including an empty editor.
- Incremental insertions, deletions, replacements, undo and redo from VS Code
  events, checked against the actual post-event text. If a delta is unavailable
  or inconsistent, a **resync** explicitly stores the exact recaptured buffer.
- A copy of every known buffer at start, approximately every ten seconds, and at
  stop. The manifest records **actual capture times**, not assumed exact intervals.
- Save, close, VS Code rename/delete, active editor, selections, visible line
  ranges, window-focus events and manual sync markers.

Scope is **open text documents in the task workspace and untitled documents**.
Unopened files, terminal output, autocomplete suggestions and screenshots are not
captured. Closed documents retain their last observed state; closing, scrolling
or deleting a file does not erase its history. A periodic rescan checks all open
buffers. External filesystem operations on unopened files are outside scope.

Each first-seen document has a separate ID, even if two files have the same name.
Rename events link paths but do not merge histories. Saving an untitled document
under a new name can create a new baseline; do not assume continuity without
checking the lifecycle events. Keep one VS Code window for the experiment; each
window records independently. Recording must be started again after a reload.

## Output components

| Component | Use |
|---|---|
| `session.json` | Participant, tool version, workspace, clock definitions, completion/error status. |
| `documents.json` | Document IDs → original URI, language, dirty flag, version, last observed time, open/closed state and current hash. |
| `baselines/d0001.java` | Exact initial editor text for that document, before applying logged edits. |
| `current/d0001.java` | One evolving current source file per document. |
| `events.jsonl` | Chronological edits, deleted text, resyncs, lifecycle/view events and clock values; one JSON record per line. |
| `snapshots/000001/d0001.java` | Checkpoint source copies; extension follows the source filename or language. |
| `snapshots.jsonl` | Maps each checkpoint to actual time, source files, hashes, document states and whether code changed since the previous checkpoint. |

Source copies are **direct editor-buffer captures**, not screenshot transcriptions
or uncertain reconstructions. They are UTF-8 representations of the editor text;
they do not promise the disk file's original encoding/BOM or byte identity. A
`saved` event means VS Code reported a save, not that a separate exact Git or disk
checkpoint was recovered. Obtain those separately when needed.

Offsets and lengths in edits use **UTF-16 code units**, as VS Code does. Apply the
listed edits in their listed descending-offset order to the preceding text.
Line and character coordinates are zero-based. Checkpoint `last_observed` values
are distinct from checkpoint time; closed buffers are explicitly carried forward.

## Clocks and eye tracking

Every event has a sequence number, UTC timestamp, Unix milliseconds and monotonic
`elapsed_ms` since recorder start. Use sequence/elapsed for ordering if the wall
clock changes. Keep these times separate from Tobii video and gaze timestamps
until you establish their relationship.

The sync notification is a **manual alignment aid**. The logged command time can
precede the notification's visible onset, so it is not a validated millisecond
clock synchronization mechanism. Locate the notification in the recording and
document the resulting offset and uncertainty. View ranges do not give pixel
coordinates; screen recordings and calibration are still needed for gaze-to-code
mapping. The tool does not assign HEM labels or train a model.

## Failure and verification

Keep the output on a writable local disk with sufficient space. A write failure
stops recording, sets an error status where possible, and displays **ERROR**.
An abrupt VS Code/computer failure may leave `status: recording`, a partial final
record or inconsistent latest files. Treat that session as interrupted and retain
it for investigation. Normal extension shutdown attempts a final checkpoint but
cannot guarantee capture after process termination or power loss.

For later analysis, the included dependency-free verifier checks edit replay,
baseline/current/snapshot hashes, checkpoint manifests, sequence continuity and
normal completion. It never executes participant code. On a machine with Node:

```
node tools/verify-session.js "/path/to/P01_session_folder"
```

If using the school-kit ZIP, first change into its `verification` folder, then
run that command. The source-project layout already has `tools` at its root.

This is an integrity check of the collected records, not proof that every OS event
was delivered, that the clocks are aligned, or that behavior was unaffected.
Full checkpoint copies and synchronous event logging favor a simple auditable
format; use this for small programming tasks, and rehearse with your actual files.
Capture is local. The extension contains no upload or network function.

## Development

Runtime: desktop VS Code 1.85 or later. No runtime dependencies. Automated tests
use a real temporary filesystem and a simulated VS Code API boundary. The test
runner uses Node 24+; packaging uses Python 3's standard library:

```
npm test
npm run package
```

The packaged VSIX contains the same plain JavaScript sources and documentation.
Packaging is local and does not publish the extension to a marketplace.
The actual VS Code installation/GUI smoke test could not run in the development
environment because Windows/WSL interop failed before launching VS Code. Automated
adapter tests are separate from a real extension-host test; use the rehearsal above.

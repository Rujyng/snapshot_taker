# Research Code Snapshots

Agreed scope: a portable VSIX for desktop VS Code, with explicit Start/Stop,
participant ID, local output, initial baselines, incremental unsaved edits,
ten-second checkpoints, and a visible synchronization marker. No source editing,
uploading, gaze-clock assumptions, or dependency installation on the school PC.

This standalone directory isolates the new tool from the original recordings,
repositories, and completed reconstruction archive. No original repository is
changed. Implementation uses Node built-ins and the VS Code API only.

1. Write failing filesystem tests, then implement the recorder and replay verifier.
2. Write adapter tests, then implement VS Code commands and capture events.
3. Package a VSIX, document installation/limitations, verify artifacts and review.

Validation: `npm test`, Node syntax checks, deterministic package inspection,
and session replay with snapshot hashes. Actual VS Code host testing is separate
from tests using a simulated VS Code API boundary.

# my-console (sketch)

A teaching sketch of a project cockpit for Claude Code: a `/my-console` slash command, a pane that docks beside the transcript,
a one-line band above the prompt, and two optional model tools. It reads a project's own state files from `.my-console/`
and runs only fixed commands from a table, each behind a yes. Copy it, rename it and replace the read model and the action
table with your project's. See ../../HOW-TO.md for the design, the settings it needs, and the traps.

# Requiem

Experimental Telegram bot running entirely on Telegram Serverless.

## MVP

Current goal: a small persistent To-Do bot that later also accepts tasks through Telegram Chat Automation.

Commands:

- `/start` / `/help` — show help
- `/add <task>` — create a task
- `/todo` — list active tasks
- `/todo all` — list active and completed tasks
- `/done <id>` — mark a task completed
- `/delete <id>` — delete a task

## Deploy

The project uses the local `@tgcloud/cli` dependency.

```bash
npm install
npx tgcloud login
npx tgcloud status
npx tgcloud push
npx tgcloud migrate
```

`.tgcloud/` contains local CLI state and credentials and is gitignored.

## Runtime

Telegram Serverless runs the code in `tgcloud/`. Runtime modules can import only the platform SDK and project-local modules under `tgcloud/`.

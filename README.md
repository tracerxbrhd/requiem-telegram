# Requiem

Experimental Telegram bot running entirely on Telegram Serverless.

## To-Do dashboard

`/todo` opens a persistent dashboard instead of producing a new bot message for every action.

The dashboard:

- keeps active tasks at the top;
- moves completed tasks to the bottom and strikes them out;
- has inline **Add task** and **Delete task** buttons;
- edits the same Telegram message after add / done / delete operations;
- stores the dashboard message and UI mode in the Telegram Serverless database.

When **Add task** is pressed, the next text message is consumed as the new task, removed from the chat when possible, and the dashboard is refreshed.

When **Delete task** is pressed, the keyboard temporarily becomes a list of tasks to delete.

Commands remain available:

- `/start`, `/help`, `/todo` — open or refresh the dashboard
- `/add <task>` — add a task directly
- `/add` — enter add mode
- `/done <id>` — mark a task completed
- `/delete <id>` — delete directly
- `/delete` — enter delete mode

## Deploy

The project uses the local `@tgcloud/cli` dependency.

```bash
npm install
npx tgcloud login
npx tgcloud status
npx tgcloud push
npx tgcloud migrate
```

Database schema changes are deployed by `push` but are only applied by the separate `migrate` step.

`.tgcloud/` contains local CLI state and credentials and is gitignored.

## Runtime

Telegram Serverless runs the code in `tgcloud/`. Runtime modules can import only the platform SDK and project-local modules under `tgcloud/`.

# Requiem

Experimental Telegram bot running on Telegram Serverless.

Requiem now has one persistent control dashboard with two panels:

- **To-Do** — persistent task list with add / complete / delete controls.
- **Legacy** — Telegram Chat Automation controls for an automatic message sent on behalf of the connected profile.

## Dashboard

Use `/start` to open the main dashboard. The bot keeps one dashboard message per user/chat and edits it in place.

The dashboard, To-Do panel, Legacy panel and heartbeat reminders use Telegram Rich Messages when available: headings, dividers, compact tables, block quotations, footers and colored in-message buttons. All user-facing UI is localized to Russian. If Rich Messages are unavailable, Requiem falls back to formatted HTML + inline keyboards.

Telegram Bot API supports replacing an existing rich message through `editMessageText(..., rich_message)`, so switching panels still edits the same persistent dashboard message.

If the dashboard message was deleted together with the chat history, the next `/start` detects that the stored message is stale and creates a fresh dashboard instead of silently failing.

Shortcuts:

- `/start` — main dashboard
- `/todo` — To-Do panel
- `/legacy` — Legacy panel

## To-Do

The To-Do panel:

- keeps active tasks at the top;
- moves completed tasks to the bottom and strikes them out;
- uses colored inline controls;
- edits the same dashboard message after changes.

Commands remain available:

- `/add <task>`
- `/done <id>`
- `/delete <id>`

## Legacy / Chat Automation

Requiem supports two switchable activation modes.

### Manual mode

Manual mode is intended for testing. The **Enable auto-reply** button arms the response immediately. Disable it when testing is finished.

Each managed private chat receives the Legacy message at most once per activation cycle. Turning manual mode off and on again starts a new cycle.

### Dead-man mode

Dead-man mode starts a heartbeat timer. The default interval is **7 days**.

The interval button cycles:

`1 day → 7 days → 30 days → 1 day`

Pressing **I am alive** resets the timer. Changing the interval while dead-man mode is active also starts a fresh interval.

Before the timer expires Requiem sends a reminder to the owner's bot chat:

- 1 day interval → reminder about 4 hours before expiry;
- 7 day interval → reminder about 24 hours before expiry;
- 30 day interval → reminder about 3 days before expiry.

If the timer expires, the next eligible incoming Chat Automation message can trigger the Legacy auto-reply.

### Legacy auto-reply

The response is sent through `business_connection_id`, so Telegram sends it on behalf of the connected user profile rather than as a normal bot message.

Requiem first tries Telegram Bot API 10.x **Rich Messages** (`sendRichMessage`) and falls back to formatted HTML if rich messages are unavailable for the connected account. The Rich Message uses a heading, divider, compact status table, quotation block, footer, and a direct button to `@uwdrequiembot`. It is also sent as a reply to the triggering incoming message.

Telegram records the actual connected bot in business-message metadata (`sender_business_bot` / business connection metadata), but clients are not required to display that attribution prominently. Therefore Requiem also states inside the message that it was generated automatically and that the account owner did not type or send it manually.

The automatic-control version exposes a software life-status monitor. Once the timer has expired, the message can show `НЕТ СИГНАЛА ≥24 Ч` because the shortest supported heartbeat interval is 1 day. Manual mode is explicitly displayed as `РУЧНАЯ АКТИВАЦИЯ`. The footer clarifies that this is based on Requiem activity confirmations rather than a physical medical biomonitor.

The message states that the profile owner is presumed dead and includes the configured new Telegram account when present. If the account field is empty, the message explicitly says that the user did not manage to configure it.

Requiem stores only connection metadata, recipient chat IDs used for one-shot suppression, Legacy settings, and timestamps. It does not persist the contents of incoming managed-chat messages.

### Telegram setup

Enable the bot's Business / Secretary functionality in BotFather, then connect `@uwdrequiembot` in Telegram Chat Automation.

The connection must be enabled and must grant Requiem permission to reply (`can_reply`). Telegram only permits business-bot replies in eligible private chats with a recent incoming message.

## Heartbeat reminders

Telegram Serverless is update-driven and does not currently expose a native cron/timer primitive. The actual dead-man decision therefore happens inside the `business_message` handler and does **not** depend on an external scheduler.

For proactive reminder notifications, this repository also contains:

`.github/workflows/heartbeat-reminders.yml`

It runs once per hour and executes the Serverless reminder sweep through the authenticated `tgcloud` CLI.

Add this GitHub Actions repository secret after merging:

`TGCLOUD_TOKEN`

Use the CLI access token from:

`BotFather → Requiem → Serverless → CLI Access → Access token`

Never commit the token itself.

The workflow is intentionally best-effort. GitHub scheduled workflows may be delayed, and public repositories automatically disable scheduled workflows after 60 days without repository activity. The Legacy auto-reply still checks the heartbeat expiry whenever a business message arrives.

The workflow can also be run manually from the GitHub **Actions** tab.

## Deploy

The project uses the local `@tgcloud/cli` dependency.

```bash
npm install
npx tgcloud login
npx tgcloud status
npx tgcloud push
npx tgcloud migrate
npx tgcloud webhook
```

This change adds new handlers for:

- `business_connection`
- `business_message`

After deployment, verify that the managed webhook includes them. If needed:

```bash
npx tgcloud webhook sync
```

Database schema changes are deployed by `push` but applied only by the separate `migrate` step.

`.tgcloud/` contains local CLI state and credentials and is gitignored.

## Runtime

Telegram Serverless runs the code in `tgcloud/`. Runtime modules can import only the platform SDK and project-local modules under `tgcloud/`.

import {
  getLegacySettings,
  maybeSendHeartbeatReminder,
  runHeartbeatReminderSweep,
} from '../lib/legacy.js';

export default async function (input, ctx) {
  const user = ctx?.initData?.user;

  // Real Mini App calls always have verified init data, so they can only
  // check their own reminder. The scheduled CLI runner has no init data
  // and performs the full sweep.
  if (user?.id) {
    const settings = await getLegacySettings(user.id);
    if (!settings) return { checked: 0, sent: 0, failed: 0 };

    const sent = await maybeSendHeartbeatReminder(settings);
    return { checked: 1, sent: sent ? 1 : 0, failed: 0 };
  }

  return await runHeartbeatReminderSweep();
}

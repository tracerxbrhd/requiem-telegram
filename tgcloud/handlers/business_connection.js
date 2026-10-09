import { upsertBusinessConnection } from '../lib/legacy.js';

export default async function (connection, ctx) {
  await upsertBusinessConnection(connection);

  console.info('Business connection updated', {
    connectionId: connection.id,
    ownerUserId: connection.user?.id,
    enabled: connection.is_enabled,
    canReply: connection.rights?.can_reply === true,
  });
}

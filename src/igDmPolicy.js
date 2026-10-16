// Match Instagram business account IDs, never handles or message senders.
// Read at each boundary so an in-process policy update also stops pending sends.
function isIgDmBlocked(igAccountId) {
  if (igAccountId == null) return false;
  const blockedIds = (process.env.IG_DM_BLOCKED_ACCOUNT_IDS || '')
    .split(',').map(id => id.trim()).filter(Boolean);
  return blockedIds.includes(String(igAccountId));
}

module.exports = { isIgDmBlocked };

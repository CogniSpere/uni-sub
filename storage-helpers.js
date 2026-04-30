export function storageGet(keys) {
  return chrome.storage.local.get(keys);
}

export function storageSet(obj) {
  return chrome.storage.local.set(obj);
}

export async function getLocalState() {
  const data = await storageGet(["userState"]);
  const s = data.userState || {};

  return {
    id: s.id || "anonymous",
    points: s.points || 0,
    badges: Array.isArray(s.badges) ? s.badges : [],
    actionTotals: { ...(s.actionTotals || {}) },
    streaks: { ...(s.streaks || {}) },
    updatedAt: Date.now(),
    ...s
  };
}

export async function saveLocalState(state) {
  await storageSet({ userState: state });
}

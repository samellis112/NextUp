/* One-time storage migration for the rename to Next Up. Saved data used to
   live under the old app's "irt-" key prefix; copy it to "nextup-" so players
   keep their history, streaks and settings, then drop the old keys. Imported
   first by game.js so it runs before any other module reads storage. */

const OLD_PREFIX = 'irt-';
const NEW_PREFIX = 'nextup-';

try {
  const oldKeys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(OLD_PREFIX)) oldKeys.push(k);
  }
  for (const k of oldKeys) {
    const nk = NEW_PREFIX + k.slice(OLD_PREFIX.length);
    if (localStorage.getItem(nk) == null) localStorage.setItem(nk, localStorage.getItem(k));
    localStorage.removeItem(k);
  }
} catch { /* storage blocked: nothing to migrate */ }

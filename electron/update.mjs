// "Is there a newer release?" — asks GitHub's public releases API, read-only, nothing about the user is sent.
// Only tells the page; downloading stays a click on the release page (portable exe, no self-update).
const API = 'https://api.github.com/repos/PJsongsana/MHWilds-Next/releases/latest';
const RELEASES = 'https://github.com/PJsongsana/MHWilds-Next/releases';

/** "0.3.0" > "0.2.0"; "v1.0.0" ok; anything unparsable → false. */
export function isNewer(latest, current) {
  const parse = (v) => /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(v ?? ''))?.slice(1).map(Number);
  const a = parse(latest), b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

/** @returns {{ latest?: string, url: string, newer: boolean, error?: boolean, checkedAt: number }} */
export async function checkUpdate(current) {
  const checkedAt = Date.now();
  try {
    const res = await fetch(API, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'HuntDashboard' }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(String(res.status));
    const json = await res.json();
    const latest = String(json.tag_name ?? '').replace(/^v/, '');
    // the page opens this link: only ever our own release pages
    const url = typeof json.html_url === 'string' && json.html_url.startsWith(`${RELEASES}/`) ? json.html_url : RELEASES;
    return { latest, url, newer: isNewer(latest, current), checkedAt };
  } catch {
    return { url: RELEASES, newer: false, error: true, checkedAt }; // offline / rate-limited: say nothing
  }
}

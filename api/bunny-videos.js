// Vercel Serverless Function — securely lists your Bunny.net Stream videos.
//
// WHERE THIS GOES:
//   In your GitHub repo, create a folder named "api" (next to index.html),
//   and put this file inside it as:  api/bunny-videos.js
//   Vercel automatically turns any file in /api into a serverless endpoint,
//   so this becomes reachable at  https://tafxportal.com/api/bunny-videos
//
// ENVIRONMENT VARIABLES (set these in Vercel — NEVER hard-code them here):
//   Vercel dashboard → your project → Settings → Environment Variables → add:
//     BUNNY_LIBRARY_ID   = your Stream video library ID (a number, e.g. 256380)
//     BUNNY_API_KEY      = your Stream library API key (from Bunny → Stream →
//                          your library → API section). This is SECRET.
//   After adding them, redeploy so they take effect.
//
// WHY A BACKEND: the API key can read/delete your entire video library, so it
// must never live in the browser bundle. It stays here on the server; the
// browser only ever receives the resulting list of videos (title, id, thumbnail).

export default async function handler(req, res) {
  const LIBRARY_ID = process.env.BUNNY_LIBRARY_ID;
  const API_KEY = process.env.BUNNY_API_KEY;

  if (!LIBRARY_ID || !API_KEY) {
    return res.status(500).json({ error: "Bunny env vars not set (BUNNY_LIBRARY_ID / BUNNY_API_KEY)." });
  }

  try {
    // Page through the library so libraries with >100 videos come back fully.
    const perPage = 100;
    let page = 1;
    let all = [];
    // Hard cap of 20 pages (2000 videos) as a safety stop.
    while (page <= 20) {
      const url = "https://video.bunnycdn.com/library/" + LIBRARY_ID +
        "/videos?page=" + page + "&itemsPerPage=" + perPage + "&orderBy=date";
      const r = await fetch(url, {
        headers: { "AccessKey": API_KEY, "accept": "application/json" },
      });
      if (!r.ok) {
        const text = await r.text();
        return res.status(r.status).json({ error: "Bunny API error: " + text });
      }
      const data = await r.json();
      const items = data.items || [];
      all = all.concat(items);
      const totalItems = data.totalItems != null ? data.totalItems : all.length;
      if (all.length >= totalItems || items.length === 0) break;
      page++;
    }

    // Build a clean, minimal payload for the browser. The API key never leaves here.
    // Thumbnails need your library's CDN hostname. Set BUNNY_CDN_HOSTNAME in Vercel
    // (Bunny → Stream → your library → API shows the "CDN Hostname", e.g.
    // vz-xxxxxxxx-xxx.b-cdn.net). If it's not set, we simply omit thumbnails.
    const cdnHost = process.env.BUNNY_CDN_HOSTNAME || null;
    const videos = all.map(v => ({
      guid: v.guid,
      title: v.title,
      length: v.length,           // seconds
      status: v.status,           // 4 = ready/encoded
      embedUrl: "https://iframe.mediadelivery.net/embed/" + LIBRARY_ID + "/" + v.guid,
      thumbnail: (cdnHost && v.thumbnailFileName)
        ? ("https://" + cdnHost.replace(/^https?:\/\//, "").replace(/\/$/, "") + "/" + v.guid + "/" + v.thumbnailFileName)
        : null,
    }));

    // Cache at the edge for 60s so repeated admin refreshes don't hammer Bunny.
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
    return res.status(200).json({ videos });
  } catch (e) {
    return res.status(500).json({ error: "Server error: " + (e && e.message ? e.message : String(e)) });
  }
}

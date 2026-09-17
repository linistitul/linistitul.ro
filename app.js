/* LINISTITUL — zero-maintenance latest video
 *
 * Cum funcționează (fără mentenanță / fără redeploy):
 * 1. La fiecare vizită, browserul cere live feed-ul public YouTube al canalului:
 *      https://www.youtube.com/feeds/videos.xml?channel_id=UCKoGpCyBAfCp-uc6DM1Lygw
 *    De îndată ce postezi un videoclip, acesta devine prima intrare din feed,
 *    deci site-ul îl afișează instant — fără editare, rebuild sau deploy.
 * 2. Feed-ul YouTube nu trimite headere CORS, deci îl citim prin servicii
 *    publice CORS-friendly, cu fallback în lanț (dacă unul pică, încercăm următorul).
 *    Ordinea e aleasă după verificare reală (17.09.2026):
 *      1) rss2json — API JSON cu `Access-Control-Allow-Origin: *`, verificat OK;
 *      2-4) proxy-uri generice (allorigins, codetabs, corsproxy) pentru XML brut.
 * 3. Dacă toate proxy-urile pică (offline / blocat), folosim:
 *    a) player-ul deja încărcat cu uploads-playlist-ul (UU...) — arată mereu cel mai nou,
 *    b) lista cache hardcodată FALLBACK_VIDEOS de mai jos (actualizată la build, opțional).
 */

const CHANNEL_ID = "UCKoGpCyBAfCp-uc6DM1Lygw";
const CHANNEL_HANDLE = "@linistitul";
const RSS_URL = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`;
const UPLOADS_PLAYLIST = "UUKoGpCyBAfCp-uc6DM1Lygw"; // UC -> UU
let AVATAR_88 = "https://yt3.googleusercontent.com/ytc/AIdro_modnbNTuRlleNjTVouvkCrV_5UEVAxuMjbnRzZcO1hdq4=s88-c-k-c0x00ffffff-no-rj";
const AVATAR_TTL = 7 * 24 * 3600 * 1000; // revalidare poză profil: max. 1× / 7 zile

// Rezervă locală — doar pentru modul offline (ultimele 3, cel mai nou primul).
const FALLBACK_VIDEOS = [
  { id: "y89569zrDdQ", title: "Un minut în Bardonecchia", published: "2025-04-04T19:21:58+00:00" },
  { id: "6ChwgySQIh0", title: "Un minut în București", published: "2025-02-28T22:00:23+00:00" },
  { id: "dJkTEQ1IgNc", title: "Un minut în Bran", published: "2025-01-25T00:00:00+00:00" },
];

const $ = (id) => document.getElementById(id);

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function formatDateRO(iso) {
  try {
    return new Intl.DateTimeFormat("ro-RO", { day: "numeric", month: "long", year: "numeric" }).format(new Date(iso));
  } catch { return ""; }
}

function timeAgoRO(iso) {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.max(1, Math.floor((Date.now() - then) / 60000));
  if (mins < 60) return mins === 1 ? "acum un minut" : `acum ${mins} minute`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours === 1 ? "acum o oră" : `acum ${hours} ore`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "ieri";
  if (days < 30) return `acum ${days} zile`;
  const months = Math.floor(days / 30);
  if (months < 12) return months === 1 ? "acum o lună" : `acum ${months} luni`;
  const years = Math.floor(months / 12);
  return years === 1 ? "acum 1 an" : `acum ${years} ani`;
}

function videoUrl(id) { return `https://www.youtube.com/watch?v=${id}`; }
function thumbUrl(id) { return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`; }
function embedUrl(id) { return `https://www.youtube.com/embed/${id}?rel=0&modestbranding=1`; }

/* ---------- RSS parsing ---------- */

function parseRssXml(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, "text/xml");
  if (doc.querySelector("parsererror")) throw new Error("XML invalid");
  const entries = [...doc.querySelectorAll("entry")];
  const videos = [];
  for (const e of entries) {
    const get = (sel) => e.querySelector(sel)?.textContent?.trim() ?? "";
    // yt:videoId poate apărea ca <yt:videoId> sau <videoId> în funcție de parser
    const id = get("videoId") || (get("id").match(/video:(.+)$/) || [])[1] || "";
    if (!/^[A-Za-z0-9_-]{6,}$/.test(id)) continue;
    const title = get("title") || "Videoclip fără titlu";
    const published = get("published") || "";
    const viewsRaw = e.querySelector("statistics")?.getAttribute("views") ?? "";
    const descNode = [...e.childNodes].find((n) => n.localName === "group");
    const description = descNode?.querySelector("description")?.textContent?.trim()
      || e.querySelector("description")?.textContent?.trim() || "";
    videos.push({ id, title, published, description, views: viewsRaw ? Number(viewsRaw) : null });
  }
  return videos;
}

function parseRss2Json(json) {
  if (!json || json.status !== "ok" || !Array.isArray(json.items)) throw new Error("rss2json invalid");
  return json.items.map((it) => {
    const link = it.link || "";
    const m = link.match(/[?&]v=([A-Za-z0-9_-]{6,})/);
    const id = m ? m[1] : "";
    if (!id) return null;
    return { id, title: it.title || "Videoclip fără titlu", published: it.pubDate || "", description: it.description || "", views: null };
  }).filter(Boolean);
}

async function fetchWithTimeout(url, ms = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } finally { clearTimeout(t); }
}

/** Încearcă sursele live în ordine, returnează { videos, source } */
async function fetchLatestVideos() {
  const enc = encodeURIComponent(RSS_URL);
  const attempts = [
    {
      // Sursa principală: API JSON cu CORS activat (Access-Control-Allow-Origin: *),
      // verificat că returnează corect feed-ul LINISTITUL.
      name: "rss2json",
      run: async () => {
        const res = await fetchWithTimeout(`https://api.rss2json.com/v1/api.json?rss_url=${enc}`);
        return parseRss2Json(await res.json());
      },
    },
    {
      name: "allorigins",
      run: async () => {
        const res = await fetchWithTimeout(`https://api.allorigins.win/get?url=${enc}`);
        const data = await res.json();
        if (!data?.contents) throw new Error("allorigins gol");
        return parseRssXml(data.contents);
      },
    },
    {
      name: "codetabs",
      run: async () => {
        const res = await fetchWithTimeout(`https://api.codetabs.com/v1/proxy?quest=${enc}`);
        return parseRssXml(await res.text());
      },
    },
    {
      name: "corsproxy",
      run: async () => {
        const res = await fetchWithTimeout(`https://corsproxy.io/?url=${enc}`);
        return parseRssXml(await res.text());
      },
    },
  ];

  const errors = [];
  for (const a of attempts) {
    try {
      const videos = await a.run();
      if (videos.length) return { videos, source: a.name };
    } catch (err) { errors.push(`${a.name}: ${err.message}`); }
  }
  throw new Error(errors.join(" | ") || "feed indisponibil");
}

/* ---------- Rendering ---------- */

function setDescription(text) {
  const el = $("videoDescription");
  const clean = String(text || "").slice(0, 320);
  el.textContent = clean;
  el.style.display = clean ? "" : "none";
}

function renderFeatured(v) {
  $("playerSkeleton")?.remove();
  const player = $("featuredPlayer");
  player.src = embedUrl(v.id);
  player.title = v.title;
  $("videoTitle").textContent = v.title;
  const bits = [`LINISTITUL • ${CHANNEL_HANDLE}`];
  if (v.published) bits.push(`${formatDateRO(v.published)} • ${timeAgoRO(v.published)}`);
  if (v.views) bits.push(`${v.views.toLocaleString("ro-RO")} vizionări`);
  $("videoMeta").textContent = bits.join("  •  ");
  setDescription(v.description);
  const watch = $("watchBtn");
  watch.href = videoUrl(v.id);
  document.title = `${v.title} — LINISTITUL`;
}

function renderGrid(videos) {
  const grid = $("videosGrid");
  grid.innerHTML = "";
  videos.slice(0, 3).forEach((v, i) => {
    const a = document.createElement("a");
    a.className = "card";
    a.href = videoUrl(v.id);
    a.target = "_blank";
    a.rel = "noopener";
    a.setAttribute("aria-label", `${v.title} — deschide pe YouTube`);
    a.innerHTML = `
      <span class="thumb">
        <img src="https://i.ytimg.com/vi/${v.id}/hq720.jpg" onerror="this.onerror=null;this.src='${thumbUrl(v.id)}'" alt="" loading="${i < 3 ? "eager" : "lazy"}" width="480" height="270" />
        <span class="play" aria-hidden="true"><svg viewBox="0 0 24 24" width="26" height="26"><path fill="currentColor" d="M8 5v14l11-7z"/></svg></span>
        ${i === 0 ? '<span class="badge-new">CEL MAI NOU</span>' : ""}
        <span class="watch-pill" aria-hidden="true">Vezi pe YouTube</span>
      </span>
      <span class="card-body">
        <img class="card-avatar" src="${AVATAR_88}" alt="" loading="lazy" width="34" height="34" />
        <span>
          <h3>${escapeHtml(v.title)}</h3>
          <p>LINISTITUL${v.published ? ` • ${escapeHtml(timeAgoRO(v.published))}` : ""}</p>
        </span>
      </span>`;
    grid.appendChild(a);
  });
}

async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; }
  catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = t; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand("copy"); ta.remove(); return ok;
    } catch { return false; }
  }
}

let lastFocus = null;
function openShare() {
  const url = $("watchBtn").href;
  const title = $("videoTitle").textContent || "LINISTITUL";
  const u = encodeURIComponent(url), t = encodeURIComponent(title);
  $("shareVideoTitle").textContent = title;
  $("shareX").href = `https://twitter.com/intent/tweet?url=${u}&text=${t}`;
  $("shareFb").href = `https://www.facebook.com/sharer/sharer.php?u=${u}`;
  $("shareWa").href = `https://wa.me/?text=${t}%20${u}`;
  $("shareMail").href = `mailto:?subject=${t}&body=${u}`;
  const label = $("copyLabel");
  label.textContent = "Copiază linkul";
  label.classList.remove("copied");
  lastFocus = document.activeElement;
  $("shareOverlay").hidden = false;
  document.body.style.overflow = "hidden";
  $("shareClose").focus();
}
function closeShare() {
  $("shareOverlay").hidden = true;
  document.body.style.overflow = "";
  if (lastFocus) lastFocus.focus();
}

async function boot(refresh = false) {
  if (!refresh) {
    $("year").textContent = new Date().getFullYear();
    // Asamblează adresa de email din coduri (anti-scrapere): nu există în clar în HTML.
    document.querySelectorAll("a[data-email]").forEach((a) => {
      const d = (s) => s.split(",").map(Number).map((c) => String.fromCharCode(c)).join("");
      const addr = `${d(a.dataset.u)}@${d(a.dataset.d)}`;
      a.href = `mailto:${addr}`;
      a.textContent = addr;
    });
    $("shareBtn").addEventListener("click", openShare);
    $("shareClose").addEventListener("click", closeShare);
    $("shareOverlay").addEventListener("click", (e) => { if (e.target === $("shareOverlay")) closeShare(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("shareOverlay").hidden) closeShare(); });
    $("copyLinkBtn").addEventListener("click", async () => {
      const ok = await copyText($("watchBtn").href);
      const label = $("copyLabel");
      label.textContent = ok ? "Link copiat ✓" : "Copierea a eșuat";
      label.classList.toggle("copied", ok);
    });
  }
  try {
    const { videos } = await fetchLatestVideos();
    renderFeatured(videos[0]);
    renderGrid(videos);
  } catch (err) {
    console.warn("Feed live indisponibil, folosesc fallback:", err);
    renderGrid(FALLBACK_VIDEOS);
    if (!refresh) {
      $("videoTitle").textContent = FALLBACK_VIDEOS[0].title;
      $("watchBtn").href = videoUrl(FALLBACK_VIDEOS[0].id);
      setDescription("");
    }
  }
}

/* ---------- Poza de profil (auto, silențios) ----------
 * Feed-ul RSS nu conține avatarul, așa că îl citim rar din pagina
 * canalului și îl memorăm în browser (max. 1 verificare / 7 zile).
 * La orice eșec, rămâne poza hardcodată — pagina nu e afectată. */
function sizedAvatar(url, size) {
  return String(url).replace(/=s\d+.*$/, `=s${size}-c-k-c0x00ffffff-no-rj`);
}

function applyAvatar(url) {
  if (!url || !url.includes("yt3.googleusercontent.com")) return;
  AVATAR_88 = sizedAvatar(url, 88);
  document.querySelectorAll("img[data-avatar]").forEach((img) => {
    img.src = sizedAvatar(url, Number(img.dataset.avatar) || 88);
  });
}

function extractAvatar(html) {
  const og = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
  if (og) return og;
  const m = html.match(/https:\\?\/\\?\/yt3\.googleusercontent\.com\\?\/[^"'\s\\]+/);
  return m ? m[0].replace(/\\\//g, "/").replace(/\\u003d/gi, "=") : "";
}

async function refreshAvatar() {
  let cached = "", ts = 0;
  try {
    cached = localStorage.getItem("linistitul_avatar_url") || "";
    ts = Number(localStorage.getItem("linistitul_avatar_ts")) || 0;
  } catch { /* stocare indisponibilă — continuăm fără cache */ }
  if (cached) applyAvatar(cached);
  if (cached && Date.now() - ts < AVATAR_TTL) return;
  const page = encodeURIComponent("https://www.youtube.com/@linistitul");
  for (const u of [`https://api.allorigins.win/get?url=${page}`, `https://api.codetabs.com/v1/proxy?quest=${page}`]) {
    try {
      const res = await fetchWithTimeout(u, 12000);
      const ct = res.headers.get("content-type") || "";
      const html = ct.includes("application/json") ? (await res.json()).contents || "" : await res.text();
      const avatar = extractAvatar(html);
      if (avatar.includes("yt3.googleusercontent.com")) {
        applyAvatar(avatar);
        try {
          localStorage.setItem("linistitul_avatar_url", avatar);
          localStorage.setItem("linistitul_avatar_ts", String(Date.now()));
        } catch { /* ignorăm */ }
        return;
      }
    } catch { /* încercăm următoarea sursă */ }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  refreshAvatar(); // sincron aplică poza memorată local, dacă există
  boot(false);
  // Revalidare silențioasă la fiecare 10 minute, pentru tab-uri lăsate deschise.
  setInterval(() => boot(true), 10 * 60 * 1000);
});

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

/* ---------- Bilingv RO/EN (doar pagina principală; blogul rămâne în română) ---------- */
const I18N = {
  ro: {
    skip: "Sari la conținut", navVideos: "Videoclipuri", subscribe: "Abonează-te",
    kicker: "Cel mai recent videoclip", loadingTitle: "Se încarcă cel mai nou videoclip…",
    loadingDesc: "Se încarcă descrierea…", watch: "Vezi pe YouTube", shareAria: "Distribuie",
    latestH2: "Ultimele videoclipuri", allVideos: "Toate videoclipurile",
    shareTitle: "Distribuie", closeAria: "Închide fereastra", copyLink: "Copiază linkul",
    copiedOk: "Link copiat ✓", copiedFail: "Copierea a eșuat",
    fdesc1: "Creator de conținut. Eu zic că e fain și merită să arunci un ochi.",
    fdesc2: "Serii cinematice „Un minut în…”, vloguri și proiecte creative.",
    umbrellaPre: "LINISTITUL este un brand ", umbrellaPost: ".",
    brandAria: "LINISTITUL — pagina principală",
    langMenu: "Alege limba",
    baseTitle: "LINISTITUL — Cele mai noi videoclipuri",
    openYT: "deschide pe YouTube", viewsWord: "vizionări", badge: "CEL MAI NOU",
  },
  en: {
    skip: "Skip to content", navVideos: "Videos", subscribe: "Subscribe",
    kicker: "Latest video", loadingTitle: "Loading the latest video…",
    loadingDesc: "Loading description…", watch: "Watch on YouTube", shareAria: "Share",
    latestH2: "Latest videos", allVideos: "All videos",
    shareTitle: "Share", closeAria: "Close dialog", copyLink: "Copy link",
    copiedOk: "Link copied ✓", copiedFail: "Copy failed",
    fdesc1: "Content creator. It might be cool and worth taking a look.",
    fdesc2: "Cinematic “One minute in…” series, vlogs and creative projects.",
    umbrellaPre: "LINISTITUL is an ", umbrellaPost: " brand.",
    brandAria: "LINISTITUL — homepage",
    langMenu: "Choose language",
    baseTitle: "LINISTITUL — Latest videos",
    openYT: "open on YouTube", viewsWord: "views", badge: "LATEST",
  },
};
let LANG = "ro";
try { if (localStorage.getItem("linistitul_lang") === "en") LANG = "en"; } catch {}
let lastVideos = null;
const T = (k) => I18N[LANG][k] ?? I18N.ro[k] ?? "";
function applyLang() {
  document.documentElement.lang = LANG;
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = T(el.dataset.i18n); });
  document.querySelectorAll("[data-i18n-aria]").forEach((el) => { el.setAttribute("aria-label", T(el.dataset.i18nAria)); });
  const lb = $("langBtn");
  if (lb) { lb.setAttribute("aria-label", T("langMenu")); lb.title = T("langMenu"); }
  if (!lastVideos) document.title = T("baseTitle");
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
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
function timeAgoEN(iso) {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.max(1, Math.floor((Date.now() - then) / 60000));
  if (mins < 60) return mins === 1 ? "1 minute ago" : `${mins} minutes ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return months === 1 ? "1 month ago" : `${months} months ago`;
  const y = Math.floor(months / 12);
  return y === 1 ? "1 year ago" : `${y} years ago`;
}
function formatDate(iso) {
  try {
    return new Intl.DateTimeFormat(LANG === "ro" ? "ro-RO" : "en-US", { day: "numeric", month: "long", year: "numeric" }).format(new Date(iso));
  } catch { return ""; }
}
const timeAgo = (iso) => (LANG === "ro" ? timeAgoRO(iso) : timeAgoEN(iso));

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
  if (v.published) bits.push(`${formatDate(v.published)} • ${timeAgo(v.published)}`);
  if (v.views) bits.push(`${v.views.toLocaleString(LANG === "ro" ? "ro-RO" : "en-US")} ${T("viewsWord")}`);
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
    a.setAttribute("aria-label", `${v.title} — ${T("openYT")}`);
    a.innerHTML = `
      <span class="thumb">
        <img src="https://i.ytimg.com/vi/${v.id}/hq720.jpg" onerror="this.onerror=null;this.src='${thumbUrl(v.id)}'" alt="" loading="${i < 3 ? "eager" : "lazy"}" width="480" height="270" />
        <span class="play" aria-hidden="true"><svg viewBox="0 0 24 24" width="26" height="26"><path fill="currentColor" d="M8 5v14l11-7z"/></svg></span>
        ${i === 0 ? '<span class="badge-new">' + T("badge") + "</span>" : ""}
        <span class="watch-pill" aria-hidden="true">${T("watch")}</span>
      </span>
      <span class="card-body">
        <img class="card-avatar" src="${AVATAR_88}" alt="" loading="lazy" width="34" height="34" />
        <span>
          <h3>${escapeHtml(v.title)}</h3>
          <p>LINISTITUL${v.published ? ` • ${escapeHtml(timeAgo(v.published))}` : ""}</p>
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
  label.textContent = T("copyLink");
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

function showLoader() {
  const o = $("langLoader");
  o.hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => o.classList.add("show")));
}
function hideLoader() {
  const o = $("langLoader");
  o.classList.remove("show");
  setTimeout(() => { o.hidden = true; }, 200);
}
function updateLangMenu() {
  document.querySelectorAll(".lang-option").forEach((b) => {
    b.setAttribute("aria-checked", String(b.dataset.lang === LANG));
  });
}
function openLangMenu() {
  const m = $("langMenu"), b = $("langBtn");
  const r = b.getBoundingClientRect();
  m.style.top = `${Math.min(r.bottom + 8, window.innerHeight - 140)}px`;
  m.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 180))}px`;
  m.hidden = false;
  b.setAttribute("aria-expanded", "true");
  updateLangMenu();
  m.querySelector(".lang-option")?.focus();
}
function closeLangMenu(focusBack = false) {
  $("langMenu").hidden = true;
  $("langBtn").setAttribute("aria-expanded", "false");
  if (focusBack) $("langBtn").focus();
}
function setLang(l) {
  if (l === LANG) { closeLangMenu(true); return; }
  closeLangMenu();
  showLoader(); // maschează reașezarea textelor în noua limbă
  setTimeout(async () => {
    LANG = l;
    try { localStorage.setItem("linistitul_lang", LANG); } catch {}
    applyLang();
    if (lastVideos) await renderVideos(lastVideos);
    hideLoader();
  }, 550);
}

/* ---------- Traducere automată RO→EN (cache local, cu fallback) ----------
 * Feed-ul YouTube nu conține traducerile (doar titlul original), iar API-ul
 * oficial ar cere cheie expusă → traducem local, o singură dată per videoclip,
 * și memorăm rezultatul în browser. La orice eșec se arată textul original. */
const TR_CACHE_PREFIX = "linistitul_tr_en_";
function trCacheGet(id) {
  try { return JSON.parse(localStorage.getItem(TR_CACHE_PREFIX + id)); }
  catch { return null; }
}
function trCacheSet(id, obj) {
  try { localStorage.setItem(TR_CACHE_PREFIX + id, JSON.stringify(obj)); } catch {}
}
async function translateOne(text) {
  const q = String(text || "").trim().slice(0, 480);
  if (!q) return "";
  const res = await fetchWithTimeout(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(q)}&langpair=ro|en`, 8000);
  const out = (await res.json())?.responseData?.translatedText || "";
  if (!out || /MYMEMORY WARNING/i.test(out)) throw new Error("traducere indisponibilă");
  return out;
}
async function withTranslations(videos) {
  const jobs = videos.map(async (v) => {
    const cached = trCacheGet(v.id);
    if (cached && cached.s === (v.title || "") && cached.sd === (v.description || "")) {
      return { ...v, title: cached.t, description: cached.d };
    }
    const [t, d] = await Promise.all([
      translateOne(v.title).catch(() => v.title || ""),
      translateOne(v.description).catch(() => v.description || ""),
    ]);
    trCacheSet(v.id, { s: v.title || "", t, sd: v.description || "", d });
    return { ...v, title: t, description: d };
  });
  const timeout = new Promise((res) => setTimeout(() => res(videos), 7000));
  return Promise.race([Promise.all(jobs), timeout]);
}
async function renderVideos(videos) {
  const vids = LANG === "en" ? await withTranslations(videos) : videos;
  renderFeatured(vids[0]);
  renderGrid(vids);
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
    applyLang();
    updateLangMenu();
    $("langBtn").addEventListener("click", (e) => {
      e.stopPropagation();
      $("langMenu").hidden ? openLangMenu() : closeLangMenu();
    });
    document.querySelectorAll(".lang-option").forEach((b) => {
      b.addEventListener("click", () => setLang(b.dataset.lang));
    });
    document.addEventListener("click", (e) => {
      if (!$("langMenu").hidden && !e.target.closest(".lang-wrap")) closeLangMenu();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !$("langMenu").hidden) closeLangMenu(true);
    });
    window.addEventListener("resize", () => { if (!$("langMenu").hidden) closeLangMenu(); });
    $("shareBtn").addEventListener("click", openShare);
    $("shareClose").addEventListener("click", closeShare);
    $("shareOverlay").addEventListener("click", (e) => { if (e.target === $("shareOverlay")) closeShare(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("shareOverlay").hidden) closeShare(); });
    $("copyLinkBtn").addEventListener("click", async () => {
      const ok = await copyText($("watchBtn").href);
      const label = $("copyLabel");
      label.textContent = ok ? T("copiedOk") : T("copiedFail");
      label.classList.toggle("copied", ok);
    });
  }
  try {
    const { videos } = await fetchLatestVideos();
    lastVideos = videos;
    await renderVideos(videos);
  } catch (err) {
    console.warn("Feed live indisponibil, folosesc fallback:", err);
    lastVideos = FALLBACK_VIDEOS;
    await renderVideos(FALLBACK_VIDEOS);
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

/* ---------- Loader inițial anti-FOUC (ascunde prima pictare nestilizată) ---------- */
function bootFromCache() {
  try {
    var nav = performance.getEntriesByType && performance.getEntriesByType("navigation")[0];
    if (!nav || typeof nav.transferSize !== "number" || nav.transferSize !== 0) return false;
    // dovadă directă că CSS-ul extern e aplicat (altfel ar fi fals pozitiv pe rețea lentă)
    var probe = document.querySelector(".wrap");
    if (!probe || getComputedStyle(probe).maxWidth !== "1180px") return false;
    var crit = ["styles.css", "app.js", "fonts.googleapis.com"];
    var res = performance.getEntriesByType("resource") || [];
    return crit.every(function (c) {
      var hit = res.filter(function (r) { return (r.name || "").indexOf(c) !== -1; });
      return hit.length > 0 && hit.every(function (r) { return r.transferSize === 0; });
    });
  } catch (e) { return false; }
}
if (bootFromCache()) {
  const bb = document.getElementById("bootLoader");
  if (bb) bb.remove();
  document.documentElement.classList.remove("boot-loading");
}
const bootT0 = Date.now();
const startHash = window.location.hash;
function hashTarget() {
  if (!startHash || startHash.length < 2) return null;
  try { return document.getElementById(decodeURIComponent(startHash.slice(1))); }
  catch { return null; }
}
try { history.scrollRestoration = "manual"; } catch {}
if (!hashTarget()) window.scrollTo(0, 0);
function hideBootLoader() {
  const b = document.getElementById("bootLoader");
  if (!b || b.dataset.done) return;
  b.dataset.done = "1";
  setTimeout(() => {
    document.documentElement.classList.remove("boot-loading");
    const t = hashTarget();
    if (t) t.scrollIntoView();
    else window.scrollTo(0, 0);
    b.classList.add("hide");
    setTimeout(() => b.remove(), 350);
  }, Math.max(0, 1200 - (Date.now() - bootT0)));
}
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => setTimeout(hideBootLoader, 300));
if (document.fonts && document.fonts.load) document.fonts.load('700 15px "Poppins"').then(() => setTimeout(hideBootLoader, 200), () => setTimeout(hideBootLoader, 200));
document.addEventListener("DOMContentLoaded", () => setTimeout(hideBootLoader, 600));
setTimeout(hideBootLoader, 3500); // cap absolut: nu blochează pagina niciodată

document.addEventListener("DOMContentLoaded", () => {
  refreshAvatar(); // sincron aplică poza memorată local, dacă există
  boot(false);
  // Revalidare silențioasă la fiecare 10 minute, pentru tab-uri lăsate deschise.
  setInterval(() => boot(true), 10 * 60 * 1000);
});

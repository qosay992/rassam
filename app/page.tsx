"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface StatusResp {
  ok: boolean;
  provider: string;
  providerLabel: string;
  styles: { id: string; name: string }[];
  sizes: { id: string; name: string }[];
  ideas: { text: string; cat: string }[];
  ideaCats: string[];
  quota: { used: number; limit: number };
}

interface GenResp {
  ok: boolean;
  msg?: string;
  image?: string;
  seed?: number;
  provider?: string;
  enhancedBy?: "llm" | "local";
  finalPrompt?: string;
  used?: number;
  limit?: number;
  retry?: boolean;
}

interface GalleryItem {
  id: string;
  src: string;
  prompt: string;
  seed: number;
  at: number;
  provider: string;
}

const DB_NAME = "rassam";
const STORE = "images";

function openDb(): Promise<IDBDatabase | null> {
  return new Promise(res => {
    if (typeof indexedDB === "undefined") return res(null);
    const rq = indexedDB.open(DB_NAME, 1);
    rq.onupgradeneeded = () => {
      const db = rq.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => res(null);
  });
}

async function dbPut(item: GalleryItem) {
  const db = await openDb();
  if (!db) return;
  db.transaction(STORE, "readwrite").objectStore(STORE).put(item);
}

async function dbGetAll(): Promise<GalleryItem[]> {
  const db = await openDb();
  if (!db) return [];
  return new Promise(res => {
    const rq = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    rq.onsuccess = () => res((rq.result as GalleryItem[]).sort((a, b) => b.at - a.at));
    rq.onerror = () => res([]);
  });
}

async function dbDel(id: string) {
  const db = await openDb();
  if (!db) return;
  db.transaction(STORE, "readwrite").objectStore(STORE).delete(id);
}

export default function Home() {
  const [st, setSt] = useState<StatusResp | null>(null);
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState("auto");
  const [size, setSize] = useState("sq");
  const [ideaCat, setIdeaCat] = useState("الكل");
  const [noEnhance, setNoEnhance] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cur, setCur] = useState<GenResp & { image?: string } | null>(null);
  const [errorBox, setErrorBox] = useState<string | null>(null);
  const [gal, setGal] = useState<GalleryItem[]>([]);
  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [showFinal, setShowFinal] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const notify = useCallback((msg: string, err = false) => {
    setToast({ msg, err });
    setTimeout(() => setToast(null), 3400);
  }, []);

  useEffect(() => {
    fetch("/api/status").then(r => r.json()).then(setSt).catch(() => {});
    dbGetAll().then(setGal);
  }, []);

  const remaining = st ? Math.max(0, st.quota.limit - st.quota.used) : 25;
  const ideas = (st?.ideas ?? []).filter(i => ideaCat === "الكل" || i.cat === ideaCat);

  // ===== التحرير =====
  const [mode, setMode] = useState<"gen" | "edit">("gen");
  const [editCmd, setEditCmd] = useState("");
  const [editSrc, setEditSrc] = useState<string | null>(null);   // data url لصورة الأساس
  const [editBefore, setEditBefore] = useState<string | null>(null); // للمعاينة قبل/بعد
  const [editBusy, setEditBusy] = useState(false);
  const [editResult, setEditResult] = useState<GenResp | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) return notify("الصيغ المقبولة: JPG / PNG / WebP", true);
    if (f.size > 6 * 1024 * 1024) return notify("حجم الصورة يتجاوز 6MB", true);
    const reader = new FileReader();
    reader.onload = () => {
      setEditSrc(String(reader.result));
      setEditResult(null);
      setEditError(null);
    };
    reader.readAsDataURL(f);
  }

  function useLastImage() {
    if (!cur?.image && !gal[0]) return notify("لا توجد صورة مولدة لاستخدامها — أنشئ أولاً", true);
    setEditSrc(cur?.image || gal[0].src);
    setEditResult(null);
    setEditError(null);
    notify("تم إدخال آخر صورة");
  }

  async function runEdit() {
    if (!editCmd.trim()) return notify("اكتب أمر التعديل", true);
    if (!editSrc) return notify("ارفع صورة أولاً", true);
    if (editBusy) return;
    setEditBusy(true);
    setEditError(null);
    setEditBefore(editSrc);
    timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000);
    try {
      const res = await fetch("/api/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: editCmd, image: editSrc }),
      });
      const j: GenResp = await res.json();
      if (!j.ok) {
        setEditError(j.msg || "تعذّر التحرير");
        if (j.used != null && st) setSt({ ...st, quota: { used: j.used, limit: j.limit || 25 } });
      } else {
        setEditResult(j);
        if (j.used != null && st) setSt({ ...st, quota: { used: j.used, limit: j.limit || 25 } });
        const item: GalleryItem = {
          id: crypto.randomUUID(),
          src: j.image!,
          prompt: `تحرير: ${editCmd}`,
          seed: 0,
          at: Date.now(),
          provider: j.provider || "",
        };
        await dbPut(item);
        setGal(g => [item, ...g]);
      }
    } catch {
      setEditError("انقطع الاتصال بالخادم");
    } finally {
      if (timerRef.current) clearInterval(timerRef.current);
      setEditBusy(false);
    }
  }

  async function downloadDataUrl(src: string) {
    const a = document.createElement("a");
    a.href = src;
    a.download = `rassam-edit-${Date.now()}.jpg`;
    a.click();
    notify("تم تنزيل الصورة");
  }

  async function generate() {
    if (!prompt.trim()) return notify("اكتب وصفاً للصورة أولاً", true);
    if (busy) return;
    setBusy(true);
    setErrorBox(null);
    setElapsed(0);
    setShowFinal(false);
    timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, style, size, noEnhance }),
        signal: ac.signal,
      });
      const j: GenResp = await res.json();
      if (!j.ok) {
        setErrorBox(j.msg || "تعذّر التوليد");
        if (j.used != null && st) setSt({ ...st, quota: { used: j.used, limit: j.limit || 25 } });
      } else {
        setCur(j);
        if (j.used != null && st) setSt({ ...st, quota: { used: j.used, limit: j.limit || 25 } });
        const item: GalleryItem = {
          id: crypto.randomUUID(),
          src: j.image!,
          prompt,
          seed: j.seed ?? 0,
          at: Date.now(),
          provider: j.provider || "",
        };
        await dbPut(item);
        setGal(g => [item, ...g]);
      }
    } catch (e: any) {
      if (e?.name !== "AbortError") notify("انقطع الاتصال بالخادم", true);
    } finally {
      if (timerRef.current) clearInterval(timerRef.current);
      abortRef.current = null;
      setBusy(false);
    }
  }

  async function download(src: string, seed: number) {
    const a = document.createElement("a");
    a.href = src;
    a.download = `rassam-${seed || Date.now()}.jpg`;
    a.click();
    notify("تم تنزيل الصورة");
  }

  function copyFinal() {
    if (cur?.finalPrompt) {
      navigator.clipboard.writeText(cur.finalPrompt);
      notify("تم نسخ الوصف المُرسل للنموذج");
    }
  }

  async function removeItem(id: string) {
    await dbDel(id);
    setGal(g => g.filter(x => x.id !== id));
  }

  function stopGen() {
    abortRef.current?.abort();
    setBusy(false);
    notify("تم إلغاء التوليد");
  }

  return (
    <>
      <header>
        <div className="brand">
          <div className="logo">رسّــام</div>
          <div className="tag">استوديو الصور بالذكاء الاصطناعي</div>
        </div>
        <span className="spacer" />
        {st && (
          <span className="pill" title="المزوّد الحالي">
            ⚙️ {st.providerLabel}
          </span>
        )}
        <span className="pill" title="يتجدد يومياً">
          🎞️ المتبقي اليوم: {remaining}
        </span>
      </header>

      <div className="wrap">
        <div className="hero">
          <h1>اكتب بالعربية… واحصل على صورة احترافية</h1>
          <p>يترجم وصفك العربي تلقائياً إلى برومبت احترافي غني بالتفاصيل البصرية</p>
        </div>

        <div className="grid">
          {/* ===== تبويبات الإنشاء/التحرير ===== */}
          <div className="card">
            <div className="tabs">
              <span className={"tab" + (mode === "gen" ? " on" : "")} onClick={() => setMode("gen")}>✨ إنشاء</span>
              <span className={"tab" + (mode === "edit" ? " on" : "")} onClick={() => setMode("edit")}>🪄 تحرير</span>
            </div>

          {mode === "gen" ? (
          <>
            <h3>🎨 لوحة الإنشاء</h3>
            <p className="sub">اكتب وصفاً بالعربية (العامية مفهومة أيضاً)</p>

            <textarea
              id="promptBox"
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="مثال: مقهى دمشقي قديم بإضاءة دافئة، رجل يشرب القهوة…"
              maxLength={2000}
            />

            <label className="lbl">النمط</label>
            <div className="chips">
              {st?.styles.map(s => (
                <span
                  key={s.id}
                  className={"chip" + (style === s.id ? " on" : "")}
                  onClick={() => setStyle(s.id)}
                >
                  {s.name}
                </span>
              ))}
            </div>

            <label className="lbl">المقاس</label>
            <select value={size} onChange={e => setSize(e.target.value)}>
              {st?.sizes.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>

            <label className="lbl opt-lbl" title="أرسل وصفك كما هو دون ترجمة وتحسين تلقائي">
              <input
                type="checkbox"
                checked={noEnhance}
                onChange={e => setNoEnhance(e.target.checked)}
                style={{ width: "auto", marginLeft: 6 }}
              />
              إرسال الوصف كما هو (بدون تحسين تلقائي)
            </label>

            <button className="btn btn-main" onClick={generate} disabled={busy || remaining <= 0}>
              {busy ? "جارٍ الرسم…" : "✨ أنشئ الصورة"}
            </button>
            {busy && (
              <button className="btn btn-ghost" style={{ width: "100%", marginTop: 8 }} onClick={stopGen}>
                إلغاء
              </button>
            )}

            <div className="hintbox">
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ color: "var(--gold2)" }}>💡 أفكار:</span>
                {(st?.ideaCats ?? []).map(c => (
                  <span key={c} className={"chip tiny" + (ideaCat === c ? " on" : "")} onClick={() => setIdeaCat(c)}>
                    {c}
                  </span>
                ))}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                {ideas.slice(0, 6).map((idea, i) => (
                  <span key={i} className="idea" onClick={() => setPrompt(idea.text)}>
                    {idea.text.length > 30 ? idea.text.slice(0, 30) + "…" : idea.text}
                  </span>
                ))}
                {ideas.length > 6 && (
                  <span
                    className="idea"
                    style={{ color: "var(--gold2)" }}
                    onClick={() => setPrompt(ideas[Math.floor(Math.random() * ideas.length)].text)}
                  >
                    ↻ فكرة عشوائية
                  </span>
                )}
              </div>
            </div>
          </>
          ) : (
          <>
            <h3>🪄 لوحة التحرير</h3>
            <p className="sub">يقرأ صورتك ويعيد إنشاءها بتعديلك — يشرح النظام محتوى صورتك أولاً ثم يطبّق التغيير</p>

            <div className="dropzone" onClick={() => fileRef.current?.click()}>
              {editSrc ? (
                <img src={editSrc} alt="الصورة الأصل" className="dz-preview" />
              ) : (
                <div className="dz-hint">
                  <div style={{ fontSize: 34 }}>📤</div>
                  <div>اضغط لاختيار صورة (JPG / PNG / WebP — حتى 6MB)</div>
                </div>
              )}
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={onPickFile} style={{ display: "none" }} />
            </div>
            <div className="row-btns">
              <button className="btn btn-ghost btn-s" onClick={() => fileRef.current?.click()}>📁 اختر صورة</button>
              <button className="btn btn-ghost btn-s" onClick={useLastImage}>🖼️ استخدم آخر صورة مولدة</button>
              {editSrc && <button className="btn btn-ghost btn-s" onClick={() => { setEditSrc(null); setEditResult(null); }}>🗑 إزالة</button>}
            </div>

            <textarea
              value={editCmd}
              onChange={e => setEditCmd(e.target.value)}
              placeholder="مثال: اجعل الجو شتاءً مع ثلج متساقط… أو: أضف فانوس ذهبي على الطاولة"
              maxLength={2000}
              style={{ minHeight: 80, marginTop: 12 }}
            />

            <button className="btn btn-main" onClick={runEdit} disabled={editBusy || remaining <= 0}>
              {editBusy ? "جارٍ التحرير…" : "🪄 طبّق التعديل"}
            </button>

            <div className="hintbox">
              <span style={{ color: "var(--gold2)" }}>💡 أوامر مفيدة:</span>
              {["اجعل الجو ليلاً مع إضاءة قمرية", "حوّلها إلى رسم زيتي", "أضف زهوراً حمراء على الطاولة", "أزل الأشخاص من المشهد", "اجعلها بلون دافئ قديم كأنها من التسعينات"].map((c, i) => (
                <span key={i} className="idea" onClick={() => setEditCmd(c)}>{c}</span>
              ))}
            </div>
          </>
          )}
          </div>

          {/* ===== منطقة العرض ===== */}
          <div className="card">
            <h3>🖼️ النتيجة</h3>
            {mode === "edit" && editResult?.image ? (
            <div className="before-after">
              <div className="ba-col">
                <div className="ba-lbl">قبل</div>
                {editBefore && <img src={editBefore} alt="قبل" className="ba-img" />}
              </div>
              <div className="ba-col">
                <div className="ba-lbl ba-after">بعد</div>
                <img src={editResult.image} alt="بعد" className="ba-img" />
                <div style={{ fontSize: 11, color: "var(--muted)", margin: "8px 0" }}>
                  إعادة إنشاء موجّهة بوصف صورتك — قد تختلف التفاصيل الدقيقة عن الأصل
                </div>
                <div className="stage-actions">
                  <button className="btn btn-ghost" onClick={() => downloadDataUrl(editResult.image!)}>⬇️ تنزيل</button>
                  <button className="btn btn-ghost" onClick={() => { setEditSrc(editResult.image!); setEditResult(null); notify("أدخلنا النتيجة للتحرير مرة أخرى"); }}>🪄 حرّرها مجدداً</button>
                </div>
              </div>
            </div>
            ) : mode === "edit" && editBusy ? (
            <div className="stage">
              <div className="loading">
                <div className="dots">🪄</div>
                <div>نطبّق تعديلك على الصورة…</div>
                <div className="bar"><i /></div>
                <div style={{ fontSize: 11, marginTop: 8, color: "var(--muted)" }}>{elapsed} ث</div>
              </div>
            </div>
            ) : mode === "edit" && editError ? (
            <div className="stage">
              <div className="errbox">
                <div className="err-ic">⚠️</div>
                <div className="err-msg">{editError}</div>
                <button className="btn btn-main" style={{ width: "auto", marginTop: 14, padding: "10px 28px" }} onClick={runEdit}>↻ أعد المحاولة</button>
              </div>
            </div>
            ) : mode === "edit" ? (
            <div className="stage">
              <div className="loading">
                <div className="dots">🪄</div>
                <div>ارفع صورة واكتب أمر التعديل… ثم اضغط «طبّق التعديل»</div>
                {st?.provider === "cloudflare" ? (
                  <div style={{ fontSize: 12, marginTop: 6, color: "var(--muted)" }}>التحرير متاح — المزوّد السحابي مفعّل</div>
                ) : (
                  <div style={{ fontSize: 12, marginTop: 6, color: "#fbbf24" }}>التحرير يتطلب تفعيل المزوّد السحابي (Cloudflare)</div>
                )}
              </div>
            </div>
            ) : (
            <div className="stage">
              {busy ? (
                <div className="loading">
                  <div className="dots">🎨</div>
                  <div>نفهم وصفك ونترجمه… ثم نرسم</div>
                  <div style={{ fontSize: 12, marginTop: 4 }}>قد يستغرق 15–90 ثانية حسب الضغط</div>
                  <div className="bar"><i /></div>
                  <div style={{ fontSize: 11, marginTop: 8, color: "var(--muted)" }}>{elapsed} ث</div>
                </div>
              ) : errorBox ? (
                <div className="errbox">
                  <div className="err-ic">⚠️</div>
                  <div className="err-msg">{errorBox}</div>
                  <button className="btn btn-main" style={{ width: "auto", marginTop: 14, padding: "10px 28px" }} onClick={generate}>
                    ↻ أعد المحاولة
                  </button>
                  <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 10 }}>
                    الفشل لا يستهلك من حصتك اليومية
                  </div>
                </div>
              ) : cur?.image ? (
                <>
                  <img src={cur.image} alt="النتيجة" />
                  <div className="stage-actions">
                    <button className="btn btn-ghost" onClick={() => download(cur.image!, cur.seed || 0)}>⬇️ تنزيل</button>
                    <button className="btn btn-ghost" onClick={generate}>🔁 توليد مثيل</button>
                    <button className="btn btn-ghost" onClick={() => setShowFinal(v => !v)}>
                      {showFinal ? "إخفاء الوصف" : "👁️ الوصف المُرسل"}
                    </button>
                  </div>
                  {showFinal && cur.finalPrompt && (
                    <div className="final-box">
                      <div className="final-head">
                        <span>
                          {cur.enhancedBy === "llm" ? "🧠 ترجمة ذكية" : "📋 ترجمة محلية"} — هذا ما فهمه النموذج:
                        </span>
                        <button className="btn btn-ghost btn-xs" onClick={copyFinal}>نسخ</button>
                      </div>
                      <div dir="ltr" className="final-text">{cur.finalPrompt}</div>
                    </div>
                  )}
                </>
              ) : (
                <div className="loading">
                  <div className="dots">🕌</div>
                  <div>اكتب وصفاً واضغط «أنشئ الصورة»</div>
                  <div style={{ fontSize: 12, marginTop: 6, color: "var(--muted)" }}>
                    ابدأ بفكرة جاهزة من قائمة الأفكار المصنّفة
                  </div>
                </div>
              )}
            </div>
            )}
          </div>
        </div>

        {/* ===== المعرض ===== */}
        <div className="gallery">
          <div className="gallery-head">
            <h3>🗂️ معرض أعمالك</h3>
            <span className="count">({gal.length}) — محفوظ محلياً في متصفحك</span>
          </div>
          {gal.length === 0 ? (
            <div className="gal"><div className="empty">لا توجد صور بعد — أنشئ أول تحفة لك!</div></div>
          ) : (
            <div className="gal">
              {gal.map(item => (
                <div key={item.id} className="item" onClick={() => { setCur({ ok: true, image: item.src, seed: item.seed }); setErrorBox(null); }}>
                  <img src={item.src} alt={item.prompt.slice(0, 30)} loading="lazy" />
                  <button
                    className="del"
                    title="حذف"
                    onClick={e => { e.stopPropagation(); removeItem(item.id); }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <footer>
          <b>رسّام</b> — مبني على نماذج مفتوحة المصدر · الطبقة التجريبية مجانية ·{" "}
          <span>جاهز للترقية إلى FLUX السحابي بمفتاح واحد</span>
        </footer>
      </div>

      {toast && <div className={"toast" + (toast.err ? " err" : "")}>{toast.msg}</div>}
    </>
  );
}

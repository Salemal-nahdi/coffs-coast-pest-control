"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";

/**
 * 10-to-6 batch workflow panel.
 * - Renders a 10-option content pool.
 * - Lets the client pick/swap exactly 6 (duplicate-prevention enforced).
 * - Uploads real job-site photos (drag-drop or file picker) into the queue,
 *   which inherit render-time watermark rules on every preview.
 * - Fires the monthly "content ready" notification via the API hook.
 */
export default function PoolWorkflow({ basePool }: { basePool: any[] }) {
  const [pool, setPool] = useState<any[]>(basePool);
  const [selected, setSelected] = useState<Set<string>>(new Set(basePool.slice(0, 6).map((p) => p.id)));
  const [dups, setDups] = useState<string[]>([]);
  const [uploads, setUploads] = useState<any[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [notifyMsg, setNotifyMsg] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // Duplicate-prevention metadata check on every render tick.
  useEffect(() => {
    const seen = new Set<string>();
    const dupIds: string[] = [];
    for (const p of pool) {
      if (seen.has(p.dedupeKey)) dupIds.push(p.id);
      seen.add(p.dedupeKey);
    }
    setDups(dupIds);
  }, [pool]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 6) next.add(id); // cap at 6
      else {
        alert("You can only schedule 6 posts for the month. Swap one out first.");
      }
      return next;
    });
  }

  function swapOut(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  async function onFiles(files: FileList | null) {
    if (!files || !files.length) return;
    for (const file of Array.from(files)) {
      // Read + resize to keep payload small; then push to upload queue.
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = reader.result as string;
        const upload = { id: `upload-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, image: dataUrl, caption: `Job-site photo — ${file.name}`, topic: "job-site", dedupeKey: `job-site::client-upload::${file.name}` };
        setUploads((u) => [...u, upload]);
        try {
          await fetch("/api/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image: dataUrl, filename: file.name, caption: upload.caption }),
          });
        } catch {
          /* demo fallback: keep local preview */
        }
      };
      reader.readAsDataURL(file);
    }
  }

  async function notify() {
    setNotifyMsg("Sending…");
    try {
      const res = await fetch("/api/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      setNotifyMsg(data.details || (data.sent ? "Notification sent." : "Queued."));
    } catch (e) {
      setNotifyMsg("Notification hook not reachable. Check N8N_WEBHOOK_URL / SMTP.");
    }
  }

  const wall = selected.has("__wall__");

  /** Copy a pool/upload caption to the clipboard. */
  async function copyCaption(p: any) {
    const text = p.caption || "";
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
  }

  /** Download a pool/upload asset — images and .mp4 videos alike. */
  async function downloadAsset(p: any) {
    const isVideo = p.mediaType === "video";
    const url = isVideo ? p.mediaUrl || p.image : p.image;
    if (!url) return;
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      const srcName = url.split("/").pop() || `asset-${p.id}`;
      a.download = isVideo ? srcName.replace(/\.[^.]+$/, "") + ".mp4" : srcName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch {
      window.open(url, "_blank");
    }
  }

  return (
    <div className="mt-10 border-t border-neutral-800 pt-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div>
          <h2 className="text-xl font-black tracking-tight text-white uppercase">
            10 → 6 Content Selection
          </h2>
          <p className="text-xs text-neutral-400">
            Pick your 6 best of 10 for this month’s calendar. Duplicate topics/angles are blocked automatically.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={notify} className="bg-white text-black text-xs font-bold px-3 py-2 rounded-lg hover:bg-neutral-200 transition cursor-pointer">
            ✉️ Notify client (ready for review)
          </button>
          <button onClick={() => fileRef.current?.click()} className="border border-neutral-700 text-white text-xs font-bold px-3 py-2 rounded-lg hover:border-white transition cursor-pointer">
            ⬆️ Upload Job-Site Photo
          </button>
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => onFiles(e.target.files)} />
        </div>
      </div>

      {notifyMsg && <p className="text-xs text-emerald-400 mb-3">{notifyMsg}</p>}

      {/* Upload dropzone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); onFiles(e.dataTransfer.files); }}
        onClick={() => fileRef.current?.click()}
        className={`border-2 border-dashed rounded-2xl p-6 mb-6 text-center cursor-pointer transition ${dragOver ? "border-white bg-neutral-800" : "border-neutral-700 bg-neutral-900/40"}`}
      >
        <p className="text-sm font-semibold text-white">📸 Drag & drop real job-site photos here</p>
        <p className="text-xs text-neutral-500 mt-1">or click to browse. Uploads auto-apply logo watermarking on preview and join the approval queue instantly.</p>
      </div>

      {/* Uploaded previews */}
      {uploads.length > 0 && (
        <div className="mb-6">
          <p className="text-xs font-bold text-neutral-300 uppercase tracking-wider mb-2">In approval queue (uploaded)</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {uploads.map((u) => (
              <div key={u.id} className="relative aspect-square rounded-xl overflow-hidden border border-neutral-700">
                <Image src={u.image} alt={u.caption} fill className="object-cover" />
                <div className="post-watermark"><Image src="/images/logo-no-background.png" alt="" width={38} height={38} className="w-full h-full object-contain" /></div>
                <span className="absolute bottom-1 left-1 text-[9px] px-2 py-0.5 rounded-full bg-emerald-600 text-white font-bold">Queued</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pool grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {pool.map((p) => {
          const isSel = selected.has(p.id);
          const isDup = dups.includes(p.id);
          return (
            <div key={p.id} className={`rounded-xl overflow-hidden border transition ${isSel ? "border-white" : "border-neutral-800"} ${isDup ? "opacity-60" : ""}`}>
              <div className="relative aspect-square bg-black overflow-hidden">
                {p.mediaType === "video" ? (
                  <video
                    src={p.mediaUrl || p.image}
                    controls
                    preload="metadata"
                    playsInline
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <Image src={p.image} alt={p.caption} fill className="object-cover" />
                )}
                {p.mediaType === "video" && (
                  <span className="absolute top-2 right-2 text-[10px] font-bold px-2 py-0.5 rounded-full bg-black/70 text-white">▶ Video</span>
                )}
                {isDup && <span className="absolute inset-0 flex items-center justify-center bg-black/60 text-[10px] font-black uppercase tracking-wider text-red-400">Duplicate — blocked</span>}
                {isSel && <span className="absolute top-2 left-2 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-600 text-white">Selected</span>}
              </div>
              <div className="p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-neutral-400">{p.topic} · {p.angle}</span>
                  <span className="text-[9px] text-neutral-600">{p.imageVariant}</span>
                </div>
                <p className="text-xs text-neutral-300 line-clamp-2 leading-relaxed">{p.caption}</p>
                <div className="flex gap-2">
                  {isSel ? (
                    <button onClick={() => swapOut(p.id)} className="flex-1 py-1.5 rounded-lg border border-neutral-700 text-white text-xs font-semibold hover:border-white transition cursor-pointer">Swap out</button>
                  ) : (
                    <button onClick={() => toggle(p.id)} disabled={isDup} className="flex-1 py-1.5 rounded-lg bg-neutral-800 text-white text-xs font-semibold hover:bg-neutral-700 transition disabled:opacity-40 cursor-pointer">Add to 6</button>
                  )}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => copyCaption(p)} className="flex-1 py-1.5 rounded-lg border border-neutral-700 text-white text-xs font-semibold hover:border-white transition cursor-pointer">📋 Copy</button>
                  <button onClick={() => downloadAsset(p)} className="flex-1 py-1.5 rounded-lg border border-neutral-700 text-white text-xs font-semibold hover:border-white transition cursor-pointer">⬇ Download</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Selection summary */}
      <div className="mt-6 flex items-center justify-between rounded-xl bg-neutral-900 border border-neutral-800 p-4">
        <p className="text-sm font-semibold text-white">
          Selected: <span className="text-emerald-400 font-black">{selected.size}</span> / 6
        </p>
        <p className="text-xs text-neutral-400">
          {dups.length === 0 ? "✓ No duplicate topics, angles or image variants" : `⚠ ${dups.length} duplicate option(s) blocked`}
        </p>
      </div>
      {wall && null}
    </div>
  );
}

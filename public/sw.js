// ملغي تسجيل تلقائي — يحرر المتصفح من عامل خدمة قديم كان يحتجز localhost:3000
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    self.registration
      .unregister()
      .then(() => self.clients.matchAll({ type: "window" }))
      .then((clients) => {
        for (const c of clients) {
          if ("navigate" in c) c.navigate(c.url);
        }
      })
  );
});

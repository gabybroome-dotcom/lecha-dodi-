const CACHE_NAME = "shabbat-sparks-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./sketch.js",
  "./manifest.webmanifest",
  "./assets/figure.png",
  "./assets/spark.png",
  "./assets/sparks/spark-01.png",
  "./assets/sparks/spark-02.png",
  "./assets/sparks/spark-03.png",
  "./assets/sparks/spark-04.png",
  "./assets/sparks/spark-05.png",
  "./assets/sparks/spark-06.png",
  "./assets/sparks/spark-07.png",
  "./assets/sparks/spark-08.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        return cached;
      }
      return fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match("./index.html"));
    })
  );
});

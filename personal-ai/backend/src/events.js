// A tiny pub/sub hub. The browser keeps one open connection to GET /api/events
// and receives things the server starts on its own, like reminders firing.
export function createEventHub() {
  const clients = new Set();
  return {
    subscribe(fn) {
      clients.add(fn);
      return () => clients.delete(fn);
    },
    publish(event) {
      for (const fn of clients) fn(event);
    },
    get size() {
      return clients.size;
    },
  };
}

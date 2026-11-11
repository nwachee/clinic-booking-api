// Fires 10 simultaneous bookings (10 different emails) at the SAME slot.
// Expect exactly one 201 and nine 409.
// Usage: BASE_URL=https://your-app.onrender.com API_KEY=xxx node scripts/race-test.mjs
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const H = { "x-api-key": process.env.API_KEY, "content-type": "application/json" };

const { slots } = await (await fetch(`${BASE}/slots`, { headers: H })).json();
const slot = slots.find((s) => s.available);
console.log("Target slot:", slot.id);

const results = await Promise.all(
  Array.from({ length: 10 }, (_, i) =>
    fetch(`${BASE}/bookings`, {
      method: "POST", headers: H,
      body: JSON.stringify({ slot_id: slot.id, name: `Racer ${i}`, email: `racer${i}@example.com` }),
    }).then((r) => r.status)
  )
);
console.log("Statuses:", results.join(", "));
console.log("201 count:", results.filter((s) => s === 201).length, "(must be 1)");

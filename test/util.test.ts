import assert from "node:assert/strict";
import { test } from "node:test";
import { clean, htmlToText, Throttle, TtlCache, truncate } from "../src/util.js";

test("clean: collapses spaces and non-breaking spaces, keeps paragraph breaks", () => {
  assert.equal(clean("  a  b \t c\n\n\n\nd  "), "a b c\n\nd");
  assert.equal(clean(undefined), "");
});

test("truncate", () => {
  assert.equal(truncate("abc", 5), "abc");
  assert.equal(truncate("abcdef", 3), "abc… [truncated]");
});

test("htmlToText: block elements become line breaks, entities are decoded", () => {
  assert.equal(htmlToText("<p>One</p><p>Two<br>Three</p>"), "One\nTwo\nThree");
  assert.equal(htmlToText("Tom &amp; Jerry&#39;s &lt;3 &hellip;"), "Tom & Jerry's <3 …");
});

test("TtlCache: expires entries after the TTL", async () => {
  const cache = new TtlCache<number>(30, 10);
  cache.set("a", 1);
  assert.equal(cache.get("a"), 1);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(cache.get("a"), undefined);
});

test("TtlCache: evicts the least recently used entry when full", () => {
  const cache = new TtlCache<number>(60_000, 2);
  cache.set("a", 1);
  cache.set("b", 2);
  cache.get("a"); // "a" is now more recent than "b"
  cache.set("c", 3);
  assert.equal(cache.get("b"), undefined);
  assert.equal(cache.get("a"), 1);
  assert.equal(cache.get("c"), 3);
});

test("Throttle: never runs more than `max` tasks at once", async () => {
  const throttle = new Throttle(2, 0);
  let running = 0;
  let peak = 0;
  const task = () =>
    throttle.run(async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 10));
      running--;
    });
  await Promise.all([task(), task(), task(), task(), task()]);
  assert.equal(peak, 2);
});

test("Throttle: spaces task starts by minDelayMs", async () => {
  const throttle = new Throttle(5, 40);
  const starts: number[] = [];
  await Promise.all([1, 2, 3].map(() => throttle.run(async () => void starts.push(Date.now()))));
  for (let i = 1; i < starts.length; i++) {
    assert.ok(starts[i] - starts[i - 1] >= 35, `gap ${starts[i] - starts[i - 1]}ms is too short`);
  }
});

test("Throttle: a failing task releases its slot", async () => {
  const throttle = new Throttle(1, 0);
  await assert.rejects(
    throttle.run(async () => {
      throw new Error("boom");
    }),
  );
  assert.equal(await throttle.run(async () => "ok"), "ok");
});

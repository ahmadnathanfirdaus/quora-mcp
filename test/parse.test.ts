import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeQuestionUrl,
  parseCount,
  parseDdgResults,
  parseProfile,
  parseQuestionPage,
  parseQuoraSearch,
  profileUrl,
} from "../src/parse.js";

test("normalizeQuestionUrl", () => {
  assert.equal(
    normalizeQuestionUrl("https://www.quora.com/What-is-Go-used-for"),
    "https://www.quora.com/What-is-Go-used-for",
  );
  assert.equal(
    normalizeQuestionUrl("https://www.quora.com/What-is-Go-used-for/answer/Jane-Doe?ch=10"),
    "https://www.quora.com/What-is-Go-used-for",
  );
  assert.equal(normalizeQuestionUrl("https://id.quora.com/Apa-itu-Kotlin"), "https://id.quora.com/Apa-itu-Kotlin");
  assert.equal(normalizeQuestionUrl("https://quora.com/Is-Rust-hard"), "https://www.quora.com/Is-Rust-hard");
  assert.equal(normalizeQuestionUrl("https://www.quora.com/profile/Jane-Doe"), null);
  assert.equal(normalizeQuestionUrl("https://www.quora.com/topic/Golang"), null);
  assert.equal(normalizeQuestionUrl("https://example.com/What-is-Go"), null);
  assert.equal(normalizeQuestionUrl("https://www.quora.com/search?q=go"), null);
});

test("profileUrl", () => {
  assert.equal(profileUrl("Jane-Doe-12"), "https://www.quora.com/profile/Jane-Doe-12");
  assert.equal(profileUrl("https://id.quora.com/profile/Budi-S/answers"), "https://id.quora.com/profile/Budi-S");
  assert.throws(() => profileUrl("https://evil.com/profile/x"));
});

test("parseCount", () => {
  assert.equal(parseCount("1,234"), 1234);
  assert.equal(parseCount("12.5K"), 12500);
  assert.equal(parseCount("3M"), 3_000_000);
  assert.equal(parseCount("2,5rb".replace(",", ".")), 2500);
});

test("parseQuestionPage: JSON-LD", () => {
  const ld = {
    "@context": "https://schema.org",
    "@type": "QAPage",
    mainEntity: {
      "@type": "Question",
      name: "What is Go used for?",
      text: "<p>Asking for backend work.</p>",
      answerCount: 42,
      acceptedAnswer: {
        "@type": "Answer",
        text: "<p>Backend services.</p><p>CLIs too &amp; more.</p>",
        upvoteCount: 120,
        author: { "@type": "Person", name: "Jane Doe", url: "https://www.quora.com/profile/Jane-Doe" },
      },
      suggestedAnswer: [
        {
          "@type": "Answer",
          text: "Cloud infra like Docker and Kubernetes.",
          upvoteCount: "33",
          author: { name: "Budi" },
        },
        { "@type": "Answer", text: "x".repeat(500), author: { name: "Long" } },
      ],
    },
  };
  const html = `<html><head><meta property="og:title" content="What is Go used for? - Quora">
    <script type="application/ld+json">${JSON.stringify(ld)}</script></head><body></body></html>`;
  const q = parseQuestionPage(html, "https://www.quora.com/What-is-Go-used-for", 2, 300);
  assert.equal(q.source, "json-ld");
  assert.equal(q.title, "What is Go used for?");
  assert.equal(q.details, "Asking for backend work.");
  assert.equal(q.answerCount, 42);
  assert.equal(q.answers.length, 2);
  assert.equal(q.answers[0].author, "Jane Doe");
  assert.equal(q.answers[0].upvotes, 120);
  assert.equal(q.answers[0].text, "Backend services.\nCLIs too & more.");
  assert.equal(q.answers[1].upvotes, 33);
  const q2 = parseQuestionPage(html, "https://www.quora.com/What-is-Go-used-for", 5, 300);
  assert.ok(q2.answers[2].text.endsWith("[truncated]"));
});

test("parseQuestionPage: DOM fallback", () => {
  const html = `<html><head><meta property="og:title" content="Apa itu Kotlin? - Quora"></head><body>
    <div class="q-box dom_annotate_question_answer_item_0">
      <a href="/profile/Budi-Santoso">Budi Santoso</a>
      <div class="q-text">Kotlin adalah bahasa pemrograman modern untuk JVM dan Android.</div>
      <button aria-label="Upvote">1.2K</button>
    </div>
    <div class="q-box dom_annotate_question_answer_item_1">
      <a href="/profile/Sari"><img></a><a href="/profile/Sari">Sari</a>
      <div class="q-text">Bahasa buatan JetBrains, sekarang dipakai juga untuk Multiplatform.</div>
    </div></body></html>`;
  const q = parseQuestionPage(html, "https://id.quora.com/Apa-itu-Kotlin", 10, 3000);
  assert.equal(q.source, "dom");
  assert.equal(q.title, "Apa itu Kotlin?");
  assert.equal(q.answers.length, 2);
  assert.equal(q.answers[0].author, "Budi Santoso");
  assert.equal(q.answers[0].authorUrl, "https://id.quora.com/profile/Budi-Santoso");
  assert.equal(q.answers[0].upvotes, 1200);
  assert.equal(q.answers[1].author, "Sari");
  assert.deepEqual(q.warnings, []);
});

test("parseQuestionPage: login wall warning", () => {
  const q = parseQuestionPage(
    "<html><body>Continue with Google</body></html>",
    "https://www.quora.com/Some-question",
    5,
    100,
  );
  assert.equal(q.answers.length, 0);
  assert.match(q.warnings[0], /login wall/);
});

test("parseDdgResults", () => {
  const enc = (u: string) => `//duckduckgo.com/l/?uddg=${encodeURIComponent(u)}&rut=abc`;
  const html = `<div class="result"><a class="result__a" href="${enc("https://www.quora.com/What-is-Go-used-for/answer/Jane")}">What is Go used for? - Quora</a>
      <a class="result__snippet">Go is used for backend...</a></div>
    <div class="result"><a class="result__a" href="${enc("https://www.quora.com/What-is-Go-used-for")}">dup</a></div>
    <div class="result"><a class="result__a" href="${enc("https://www.quora.com/profile/Jane")}">Jane - Quora</a></div>
    <div class="result"><a class="result__a" href="https://id.quora.com/Apa-itu-Golang">Apa itu Golang?</a></div>`;
  const r = parseDdgResults(html, 10);
  assert.equal(r.length, 2);
  assert.deepEqual(r[0], {
    title: "What is Go used for?",
    url: "https://www.quora.com/What-is-Go-used-for",
    snippet: "Go is used for backend...",
  });
  assert.equal(r[1].url, "https://id.quora.com/Apa-itu-Golang");
});

test("parseQuoraSearch", () => {
  const html = `<a href="/What-is-Go-used-for">What is Go used for?</a><a href="/What-is-Go-used-for">What is Go used for?</a>
    <a href="/profile/Jane">Jane Doe the expert</a><a href="/Is-Go-fast">Go?</a><a href="/Is-Go-faster-than-Java">Is Go faster than Java?</a>`;
  const r = parseQuoraSearch(html, "https://www.quora.com/search?q=go", 10);
  assert.deepEqual(
    r.map((x) => x.url),
    ["https://www.quora.com/What-is-Go-used-for", "https://www.quora.com/Is-Go-faster-than-Java"],
  );
});

test("parseProfile", () => {
  const html = `<html><head><meta property="og:title" content="Jane Doe - Quora">
    <meta property="og:description" content="Software engineer at Acme"></head>
    <body><div>12.5K followers</div><div>340 following</div><div>892 answers</div><div>1.2M content views</div></body></html>`;
  const p = parseProfile(html, "https://www.quora.com/profile/Jane-Doe");
  assert.equal(p.name, "Jane Doe");
  assert.equal(p.bio, "Software engineer at Acme");
  assert.deepEqual(p.stats, { followers: 12500, following: 340, answers: 892, contentViews: 1_200_000 });
  const pid = parseProfile(
    `<html><head><meta property="og:title" content="Budi"></head><body>2rb pengikut · 15 jawaban</body></html>`,
    "u",
  );
  assert.deepEqual(pid.stats, { followers: 2000, answers: 15 });
});

test("parseQuestionPage: JSON-LD entities are decoded", () => {
  const ld = {
    "@type": "QAPage",
    mainEntity: {
      "@type": "Question",
      name: "Why?",
      suggestedAnswer: [{ "@type": "Answer", text: "<p>It&#8217;s fine &mdash; really &amp; truly.</p>" }],
    },
  };
  const html = `<html><head><script type="application/ld+json">${JSON.stringify(ld)}</script></head></html>`;
  const q = parseQuestionPage(html, "https://www.quora.com/Why", 5, 3000);
  assert.equal(q.source, "json-ld");
  assert.equal(q.answers[0].text, "It\u2019s fine \u2014 really & truly.");
});

test("parseQuestionPage: malformed JSON-LD falls back to the next block", () => {
  const ld = { "@type": "QAPage", mainEntity: { name: "Q", acceptedAnswer: { text: "Answer body" } } };
  const html = `<script type="application/ld+json">{not json</script><script type="application/ld+json">${JSON.stringify(ld)}</script>`;
  const q = parseQuestionPage(html, "https://www.quora.com/Q-x", 5, 3000);
  assert.equal(q.source, "json-ld");
  assert.equal(q.answers[0].text, "Answer body");
});

test("parseQuoraSearch: a malformed href does not break the whole page", () => {
  const html = `<a href="http://[bad">broken link here</a>
    <a href="/How-do-I-learn-Rust">How do I learn Rust quickly?</a>`;
  const hits = parseQuoraSearch(html, "https://www.quora.com/search?q=rust", 5);
  assert.deepEqual(
    hits.map((h) => h.url),
    ["https://www.quora.com/How-do-I-learn-Rust"],
  );
});

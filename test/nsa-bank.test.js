import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadQuestions, TYPE2_KEY } from '../nsa-anatomy/scripts/build.mjs';

test('NSA question bank validates', () => {
  const { questions, regions, errors } = loadQuestions();
  assert.deepEqual(errors, []);
  assert.ok(questions.length > 250);
  const codes = new Set(regions.map((r) => r.code));
  for (const q of questions) assert.ok(codes.has(q.r), `unknown region ${q.r}`);
});

test('every Type 2 question maps to a key letter consistent with its statements', () => {
  const { questions } = loadQuestions();
  for (const q of questions.filter((x) => x.y === 2)) {
    const pattern = q.o.map((o) => (o[1] ? 'T' : 'F')).join('');
    assert.equal(TYPE2_KEY[pattern], q.k, q.s);
  }
});

test('question ids are unique and stable', () => {
  const a = loadQuestions().questions.map((q) => q.id);
  const b = loadQuestions().questions.map((q) => q.id);
  assert.equal(new Set(a).size, a.length);
  assert.deepEqual(a, b);
});

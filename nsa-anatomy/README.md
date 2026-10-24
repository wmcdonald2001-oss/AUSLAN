# NSA Anatomy Bank

A question bank for the Neurosurgical Society of Australasia Neurosurgery Anatomy Examination (19 February 2027), written to *Last's Anatomy, Regional and Applied*, 9th edition.

- 272 questions in the exam's two formats, each statement with its own explanation:
  - **Type 1:** mark four statements true or false.
  - **Type 2:** pick one letter from the A–E key.
- 11 regions to filter by: skull and cranial cavity, brain and spinal cord, cranial nerves, vertebral column, head and neck, upper and lower limb, thorax, abdomen and pelvis, autonomic nervous system, and general principles and embryology.
- **Practice** marks each answer straight away. **Exam** runs a timed 60-question, 100-minute mock with a 70% pass line. **Progress** shows your accuracy by region.
- **Cards** (flashcards) appear when the page is built with an Anki export. The Anki deck is not stored in this repository.

## Type 2 key

| Letter | Meaning |
|---|---|
| A | 1, 2 and 3 are correct |
| B | 1 and 3 are correct |
| C | 2 and 4 are correct |
| D | Only 4 is correct |
| E | All are correct |

Check this key against the samples in the NSA examination information document. If it differs, change `TYPE2_KEY` in `scripts/build.mjs` and `KEY_TEXT` in `src/app.html`.

## Editing questions

Questions live in `questions/<region>.json`. Each one looks like this:

```json
{"t": "Topic", "y": 1, "s": "Stem:", "o": [["Statement", 1, "Why it is true"], ["Statement", 0, "Why it is false"], ...]}
```

`y` is the question type (1 or 2). In each option, the second value is `1` for true and `0` for false. A Type 2 question's true/false pattern must match one key letter. The build rejects any pattern that doesn't.

## Building

```bash
node nsa-anatomy/scripts/build.mjs                      # questions only -> nsa-anatomy/dist/index.html
node nsa-anatomy/scripts/build.mjs --anki deck.txt      # include an Anki "Notes in Plain Text" export as flashcards
npm test                                                # includes validation of the question bank
```

The output is a single HTML file. Open it in a browser, or host it (for example on GitHub Pages) and add it to your phone's home screen. Progress is kept in the browser. When the page runs as a claude.ai artifact, progress also syncs to your account, so your laptop and phone stay in step.

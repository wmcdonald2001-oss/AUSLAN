# AUSLAN Interpreter

A browser app that helps a Deaf AUSLAN signer and a hearing person talk to each other in real time.

| Direction | How it works |
|---|---|
| **Signer → hearing person** | The camera tracks both hands. Recognised signs build a phrase, which is shown as text **and spoken aloud**. |
| **Hearing person → signer** | The microphone transcribes speech into **large captions**. Each word links to [Auslan Signbank](https://auslan.org.au) so you can look up the sign. |
| **Text** | Either person can type instead. Typed signer messages are spoken aloud too. |

Everything runs on the device. Video and audio are never uploaded (speech recognition uses the browser's built-in service, which may run in the cloud depending on the browser).

## Running it

The camera only works over **https** or on **localhost**.

```bash
npm start          # serves the app at http://localhost:8080
npm test           # unit tests for feature extraction, the classifier and storage
```

No build step or dependencies are needed. To put it online, publish the repository with **GitHub Pages** (Settings → Pages → deploy from branch) and open the https link on a phone or laptop. Use "Add to Home Screen" to install it like an app. After the first visit it also works offline, apart from speech recognition.

Best in **Chrome or Edge** (desktop or Android). Safari works for the camera and speech output; its speech recognition support varies.

## Using it

1. Press **Start interpreter** and allow the camera.
2. **Teach signs:** type a word (e.g. `hello`) or a letter (e.g. `A`), press **Record**, and hold the sign for about 2 seconds after the countdown. Record each sign 2–3 times. Single letters are treated as fingerspelling and join into words (`B`,`E`,`N` → `BEN`).
3. Sign. Recognised signs appear under **Signed so far**. Lower your hands for a moment (2.5 s by default, adjustable in ⚙︎ Settings) and the phrase is spoken aloud. You can also press **Say it**.
4. Press **🎤 Listen** so the hearing person's speech shows as captions. The microphone pauses while the app is speaking so it doesn't transcribe itself.
5. Use **Export signs** / **Import signs** to back up a sign set or share it with another device.

## How recognition works

- [MediaPipe Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker) finds 21 points on each hand (`js/tracker.js`).
- The points are turned into a 130-number description of the hand shapes that doesn't depend on where the person is in the frame or how close they are (`js/features.js`).
- A k-nearest-neighbour classifier compares each frame with the signs you recorded. It rejects anything that isn't close to a known sign, using a cut-off calibrated from your own recordings (`js/classifier.js`).
- A stabiliser only accepts a sign once it has been held for several frames, and won't repeat it until the hands change or drop.

### Limitations (please read)

This is a **conversation aid, not a replacement for a qualified AUSLAN interpreter**. Do not rely on it for medical, legal or emergency situations. Book a professional interpreter through services such as Deaf Connect or the National Relay Service for those.

- It only knows the signs you teach it. No AUSLAN vocabulary is built in.
- It recognises **hand shapes and the position of the hands relative to each other**. It does not yet understand movement, facial expression, mouthing or body position, which are all part of AUSLAN grammar. Signs that differ only in movement will be confused.
- To fingerspell a double letter (e.g. "LL"), briefly relax or lower your hands between the two letters.
- The output is a word-for-word gloss, not fluent English.

## Ideas for next steps

- Recognise movement by comparing short sequences of frames (e.g. dynamic time warping) instead of single poses.
- Add MediaPipe face and pose tracking so location on the body and facial expression can count.
- Ship a starter sign set (such as the two-handed fingerspelling alphabet) recorded by fluent signers.
- Show sign videos from Signbank inline next to captions.

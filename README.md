# Agastya Archive

## Site settings

Edit `site-config.js` in the project root to change the displayed version and enable or disable site features. Bump `version` when publishing a site change so returning visitors see the update banner.

Episode reactions are global: every visitor’s pick is counted on the server (one vote per browser per episode) and totals refresh with the live episode check.

Available feature switches: `updateNotices`, `episodeFilters`, `episodeReactions`, `hostPanel`, `episodeDeletion`, `customAudioPlayer`, `transcript`, `autoChapters`, `episodeScheduling`, `aiDescription`, `scriptGenerator`, `transcribeAudio`, `backgroundMusic`, `appleEmojis`, `hostIdeas`, `episodeDrafts`, `textToSpeech`, `autoReloadOnUpdate`, and `liveEpisodeUpdates`. Pages check for a version change every minute and when the visitor returns to the tab, then reload once a new version is found. Set `autoReloadOnUpdate` to `false` to disable this. Published episodes are checked every minute and when the visitor returns to the tab; set `liveEpisodeUpdates` to `false` to disable this. The list refresh waits until active playback ends so it does not interrupt an episode.

## API routes

EdgeOne maps `cloud-functions/api/episodes.js` to `/api/episodes` and `cloud-functions/api/audio.js` to `/api/audio`. Keep those files in the top-level `cloud-functions/api` directory and include the folder in the deployment source. Audio chunks upload through the same-origin function to avoid browser cross-origin upload failures. Redeploy after changing function files.

## Episode tools

Transcribed words are highlighted and clickable during playback. New episodes get word timings before publishing, and the dashboard can generate missing timings for older episodes. When enabled, Gemini creates editable chapter markers from timestamped transcripts; listeners can jump to each chapter from the episode card. Gemini word timestamps do not support the custom-vocabulary option, so transcription uses an explicit spelling hint for Agastya instead. The homepage and episode cards credit Agastya as host, Marieke as co-host, Mr. Thadhani for the idea, and Caleb for development. The host panel can generate editable episode scripts asynchronously with duration, tone, and rant-level controls; transcribe audio with word-level timestamps and an exact-spelling hint for Agastya; generate a description; publish now; or schedule a future release. Background script and chapter jobs are stored by Gemini for up to 7 days so their status and results can be polled. Add GEMINI_API_KEY to the cloud-function environment; optionally set GEMINI_TRANSCRIBE_MODEL and GEMINI_TEXT_MODEL. Scheduled episodes appear publicly when their publish time arrives. The host panel can reschedule, publish now, or delete them.

## Host area

`/host/` is the host-only area. The footer "Host panel" link on the public site goes there, and it asks for `ADMIN_PASSWORD`. **Dashboard**, **Record**, and **Ideas** share one animated, hash-routed workspace; direct links such as `/host/#record` open a specific tab. The Dashboard (`host/dashboard-view.html`) shows episode counts, storage used, scheduled episodes (reschedule, publish now, delete), and published episodes with search and delete. Analytics load separately so the dashboard appears sooner. Record (`host/record.html`) holds recording, file upload, transcription, chapters, AI description, scheduling, and publishing. Its waveform editor can select audio to cut, trim, or replace, with undo and redo. Shared login and the API helper live in `host/shell.js`; styles in `host/host.css`. Turn the whole area off with the `hostPanel` switch in `site-config.js`.

The host dashboard also shows rolling 30-day listening estimates: play sessions, approximate unique listeners, top episodes, daily activity, and the busiest listening hour. Analytics are recorded only when playback starts; repeated starts for the same episode in the same browser and hour count once. A random browser ID is used to estimate repeat listeners; no IP address is collected. Hour-of-day data uses each listener's local clock and combines time zones, so treat it as a rough trend rather than a precise audience measurement.

Listeners can post public comments on published episodes; comments appear immediately. Hosts can review recent comments in the Dashboard and delete them. The host workspace uses custom dialogs and toast notifications, while the public page includes a loading state and changelog.

### Ideas, drafts, read aloud and emoji

- **Ideas** (`host/ideas.html`): a shared board for hosts and co-hosts, with an Idea generator tab that uses Gemini to suggest episode angles. Generate ideas by topic or AP World unit, add suggestions to the board, or open a suggestion directly in the Record page. Pitch an idea, change its status, comment, and click Start episode to open the Record page pre-filled. Each person picks a name and role (Host or Co-host) the first time they unlock the host area. Names are labels, not logins: everyone shares the same `ADMIN_PASSWORD`.
- **Drafts**: Save draft on the Record page keeps the form, private script and notes, transcript, chapters and the audio (if any). Drafts live on the dashboard with Continue and Delete, and are never public. Continue restores saved audio so you can pick up where you left off. Publishing a draft removes it and keeps its audio.
- **Read aloud** (`host/tts.js`): reads the private script, description or transcript with the browser's built-in voices. Browsers can't save that speech as an audio file, so it's for rehearsal and proofreading.
- **Apple emoji** (`emoji.js`): swaps emoji for Apple-style images on every device, like MemberScript #77. Apple's emoji artwork is Apple's copyright; set `appleEmojis` to `false` to use each device's own emoji. Emoji inside dropdown menus and text boxes can't be swapped and stay native.

## Latest release

Version 1.7.0 adds the one-page animated host workspace, waveform selection edits with replace/undo/redo, a refreshed archive logo, loading and toast notifications, public episode comments with a host inbox, and a visible changelog.

### Audio editor, loading screen and speed (v1.8.0)

- **Audio editor** (`host/editor.js`, on the Record tab once there is audio): a non-destructive timeline. Drag to select, click to move the playhead, zoom with the buttons or Ctrl+wheel, and use the overview strip to jump around. Delete, cut, copy, paste, keep only the selection, mute, add silence, fade in/out, change volume, normalize, and tighten long pauses all work instantly and can be undone (Ctrl+Z / Ctrl+Shift+Z). **Record at playhead** and **Replace selection** punch in a new take through the same mic filters; you can also insert or replace with an audio file. Chapter times follow your edits. Nothing is re-encoded until you publish, save a draft, or press *Render edits now*, and then the result is a compact 64 kbps mono MP3, which keeps files small. Shortcuts: Space play/pause, Delete remove selection, Ctrl+X/C/V, Ctrl+A, arrow keys nudge the playhead, +/- zoom, 0 fit, Esc deselect. Imported files up to 100 MB can be edited.
- **MP3 encoding** uses lamejs (`host/vendor/lame.min.js`), which is LGPL-3.0 licensed (see `host/vendor/LAME-LICENSE.txt`). It only loads when you first render edits.
- **Loading screen** (`boot.js` plus a small inline style in `index.html` and `host/index.html`): shown only if a page takes longer than about 0.2 s, so quick loads never flash it.
- **Speed**: the public episode list no longer includes transcripts (each loads when opened), the list is revalidated with an ETag, and repeat visitors see their last-seen list instantly while it refreshes in the background. The API keeps a short in-memory cache, reads transcripts from separate blobs, runs analytics lookups in parallel, and published audio is cached for a year. The host workspace opens immediately for a known password, downloads tab scripts in parallel, and warms the other tabs while idle. The first time a host unlocks after this update, old episodes' transcripts are moved out of `episodes.json` automatically (a one-time tidy-up).
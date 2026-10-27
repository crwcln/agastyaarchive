# Agastya Archive

## Site settings

Edit `site-config.js` in the project root to change the displayed version and enable or disable site features. Bump `version` when publishing a site change so returning visitors see the update banner.

Available feature switches: `updateNotices`, `episodeFilters`, `hostPanel`, `episodeDeletion`, `customAudioPlayer`, `transcript`, `episodeScheduling`, `aiDescription`, `scriptGenerator`, `transcribeAudio`, `backgroundMusic`, `autoReloadOnUpdate`, and `liveEpisodeUpdates`. Pages check for a version change every minute and when the visitor returns to the tab, then reload once a new version is found. Set `autoReloadOnUpdate` to `false` to disable this. Published episodes are checked every minute and when the visitor returns to the tab; set `liveEpisodeUpdates` to `false` to disable this. The list refresh waits until active playback ends so it does not interrupt an episode.

## API routes

EdgeOne maps `cloud-functions/api/episodes.js` to `/api/episodes` and `cloud-functions/api/audio.js` to `/api/audio`. Keep those files in the top-level `cloud-functions/api` directory and include the folder in the deployment source. Audio chunks upload through the same-origin function to avoid browser cross-origin upload failures. Redeploy after changing function files.

## Episode tools

Transcribed words are highlighted and clickable during playback. Gemini word timestamps do not support the custom-vocabulary option, so transcription uses an explicit spelling hint for Agastya instead. The host panel can generate editable episode scripts with duration, tone, and rant-level controls; transcribe audio with word-level timestamps and an exact-spelling hint for Agastya; generate a description; publish now; or schedule a future release. Add GEMINI_API_KEY to the cloud-function environment; optionally set GEMINI_TRANSCRIBE_MODEL and GEMINI_TEXT_MODEL. Scheduled episodes appear publicly when their publish time arrives. The host panel can reschedule, publish now, or delete them.

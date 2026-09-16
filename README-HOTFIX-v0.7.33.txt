Turkey Bowling v0.7.33 hotfix

Changed client files only; no server source change is required.

1. Host Matchups now shows live SCORE, FRAME and WINS for all players, sorted by current score descending.
2. Live spectator playback is protected from incoming state rerenders, so the complete exact seeded bowl remains visible through pin impact and settling.
3. The fallen-pin rack is held briefly before applying the latest server state.
4. v0.7.32 host focus and spectator result behaviour are retained.

/* ==================================================================================================
MODULE BOUNDARY: Shared Sync Endpoint Configuration
================================================================================================== */

// CURRENT STATE: One place that names the multiplayer sync backend.
// TARGET STATE: Stay the only file that has to change when this copy of the table is pointed at a
// different deployment.
// PUT HERE: Base URL and derived endpoint paths.
// DO NOT PUT HERE: Fetching, polling, retry policy, or payload shapes.

// ---------------------------------------------------------------------------------------------
// DEPLOYING YOUR OWN COPY
//
// This defaults to the upstream project's backend, which only accepts requests from the upstream
// site. Serve this table from anywhere else and every sync call is rejected by CORS, which looks
// exactly like "the buttons never appear on my phone" — no error, just a table that never updates.
//
// So: deploy api/main.js to your own Deno Deploy project, set ALLOWED_ORIGINS there to the origin
// you serve these pages from (e.g. https://yourname.github.io), and put that project's URL here.
// ---------------------------------------------------------------------------------------------
export const SYNC_API_BASE_URL = "https://poker.tehes.deno.net";

export const STATE_ENDPOINT = `${SYNC_API_BASE_URL}/state`;
export const ACTION_ENDPOINT = `${SYNC_API_BASE_URL}/action`;

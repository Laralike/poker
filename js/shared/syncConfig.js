/* ==================================================================================================
MODULE BOUNDARY: Shared Sync Endpoint Configuration
================================================================================================== */

// CURRENT STATE: One place that names the multiplayer sync backend.
// TARGET STATE: Stay the only file that has to change when this copy of the table is pointed at a
// different deployment.
// PUT HERE: Base URL and derived endpoint paths.
// DO NOT PUT HERE: Fetching, polling, retry policy, or payload shapes.

// ---------------------------------------------------------------------------------------------
// THE TABLE SERVER
//
// This copy's own server, running api/main.js. It only accepts requests from the sites listed in
// DEFAULT_ALLOWED_ORIGINS at the top of that file, so if you ever move where these pages are served
// from, that list has to change too — otherwise every sync call is refused and the game just never
// updates, with nothing on screen to say why.
//
// The table checks this server is reachable before you start a game for two or more people, and
// says so plainly if it is not.
// ---------------------------------------------------------------------------------------------
export const SYNC_API_BASE_URL = "https://poker-wp9o.onrender.com";

// The upstream deployment only accepts requests from the upstream site, so while this still points
// at it, multiplayer cannot work from a copy. The setup panel uses this to say so plainly instead of
// letting people pick a game that will never show them their cards.
const UPSTREAM_DEFAULT_BASE_URL = "https://poker.tehes.deno.net";
export const IS_SYNC_BACKEND_CONFIGURED = SYNC_API_BASE_URL !== UPSTREAM_DEFAULT_BASE_URL;

export const STATE_ENDPOINT = `${SYNC_API_BASE_URL}/state`;
export const ACTION_ENDPOINT = `${SYNC_API_BASE_URL}/action`;
export const TABLE_ENDPOINT = `${SYNC_API_BASE_URL}/table`;
export const HEALTH_ENDPOINT = `${SYNC_API_BASE_URL}/health`;
export const COMMAND_ENDPOINT = `${SYNC_API_BASE_URL}/command`;

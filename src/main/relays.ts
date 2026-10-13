/**
 * Nostr relays that carry internet rooms. Every member connects to all of them, so two members meet as long as they
 * share one that works.
 *
 * Self-hosted: this fork carries internet rooms on its own relay (tools/own-relay on an Aliyun box), checked with
 * tools/relay-probe on 2026-10-13 (20/20 echoes, median 9 ms, 30 s burst clean). The upstream public list was:
 * wss://nos.lol, wss://nostr.mom, wss://relay.snort.social, wss://relay.agentry.com, wss://relay.routstr.com,
 * wss://nostr.rblb.it — append those back here to also meet clients still on the public relays.
 *
 * Members only meet on a relay both sides list, so everyone must run a build pointing at the same server.
 */
export const RELAYS: readonly string[] = [
  'ws://8.137.204.7:37979',
];

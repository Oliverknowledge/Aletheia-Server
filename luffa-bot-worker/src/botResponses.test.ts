import test from "node:test";
import assert from "node:assert/strict";

import { parseMessage } from "./messageParser";
import { formatHelpMessage, formatStatusMessage } from "./botResponses";

test("parseMessage recognizes /status as a command", () => {
  assert.deepEqual(parseMessage("/status", false), {
    type: "command",
    command: "status"
  });
});

test("formatHelpMessage explains the available commands", () => {
  const message = formatHelpMessage();

  assert.match(message, /How to play/i);
  assert.match(message, /\/status/i);
  assert.match(message, /\/help/i);
});

test("formatStatusMessage reports an inactive game clearly", () => {
  const message = formatStatusMessage({
    gameActive: false,
    currentTopic: "",
    currentRoundNumber: 0,
    currentScore: 0
  });

  assert.match(message, /No active game/i);
});

test("formatStatusMessage reports active game details", () => {
  const message = formatStatusMessage({
    gameActive: true,
    currentTopic: "Planets",
    currentRoundNumber: 3,
    currentScore: 2
  });

  assert.match(message, /Active game/i);
  assert.match(message, /Topic: Planets/i);
  assert.match(message, /Round: 3/i);
  assert.match(message, /Score: 2/i);
});

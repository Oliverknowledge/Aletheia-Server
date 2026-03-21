import assert from "node:assert/strict";

async function run(): Promise<void> {
  process.env.LUFFA_BOT_UID = process.env.LUFFA_BOT_UID || "test_uid";
  process.env.LUFFA_BOT_SECRET = process.env.LUFFA_BOT_SECRET || "test_secret";
  process.env.POLL_INTERVAL_MS = process.env.POLL_INTERVAL_MS || "1000";

  const { LuffaApiClient } = await import("./luffaApi");

  const samplePayload = [
    {
      count: 1,
      message: [
        '{"uid":"A4zVqqs7KLr","msgId":"72371963-5BB1-482F-B3F8-30640B39A6B2","text":"Hello "}'
      ],
      type: 0,
      uid: "A4zVqqs7KLr"
    }
  ];

  const client = new LuffaApiClient();
  (client as any).http.post = async () => ({
    status: 200,
    data: samplePayload
  });

  const result = await client.receiveMessages();

  assert.equal(result.messages.length, 1, "Expected 1 normalized message");

  const first = result.messages[0];
  assert.equal(first.envelopeUid, "A4zVqqs7KLr");
  assert.equal(first.uid, "A4zVqqs7KLr");
  assert.equal(first.msgId, "72371963-5BB1-482F-B3F8-30640B39A6B2");
  assert.equal(first.messageId, "72371963-5BB1-482F-B3F8-30640B39A6B2");
  assert.equal(first.text, "Hello");
  assert.equal(first.isGroup, false);
  assert.equal(first.type, "0");

  console.log("[parse-check] PASS");
}

run().catch((error) => {
  console.error("[parse-check] FAIL", error);
  process.exit(1);
});

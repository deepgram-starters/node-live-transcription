const { createReadStream } = require('fs');
const { createClient, LiveTranscriptionEvents } = require("@deepgram/sdk");
const dotenv = require("dotenv");
dotenv.config();

const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

describe('Deepgram response test',  () => {
  it('should contain the required keys in the correct shape', (done) => {
    const live = deepgram.listen.live({ smart_format: true, model: "nova-2" });

    live.on(LiveTranscriptionEvents.Open, () => {

      live.on(LiveTranscriptionEvents.Transcript, (data) => {
        try {
          // Validate the response shape
          expect(data).toHaveProperty('channel.alternatives[0].transcript');
          console.log("Response:",data);
          done(); 
        } catch (error) {
          done(error);
        }
      });

      const stream = createReadStream('public/test/preamble.wav');
      stream.on('data', (chunk) => {
        if(chunk.length > 0) {
          live.send(chunk);
          live.finish() // We only need to test one response
        }
      });
    });
  });
});

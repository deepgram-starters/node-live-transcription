const captions = window.document.getElementById("captions");

async function getMicrophone() {
  const userMedia = await navigator.mediaDevices.getUserMedia({
    audio: true,
  });

  return new MediaRecorder(userMedia);
}

async function openMicrophone(microphone, socket) {
  await microphone.start(500);

  microphone.onstart = () => {
    console.log("client: microphone opened");
    document.body.classList.add("recording");
  };

  microphone.onstop = () => {
    console.log("client: microphone closed");
    document.body.classList.remove("recording");
  };

  microphone.ondataavailable = (e) => {
    console.log("client: sent data to websocket");
    socket.emit("packet-sent", e.data);
  };
}

async function closeMicrophone(microphone) {
  microphone.stop();
}

async function start(socket) {
  const listenButton = document.getElementById("record");
  let microphone;

  console.log("client: waiting to open microphone");

  listenButton.addEventListener("click", async () => {
    if (!microphone) {
      // open and close the microphone
      microphone = await getMicrophone();
      await openMicrophone(microphone, socket);
    } else {
      await closeMicrophone(microphone);
      microphone = undefined;
    }
  });
}

window.addEventListener("load", () => {
  const socket = io((options = { transports: ["websocket"] }));

  socket.on("connect", async () => {
    console.log("client: connected to websocket");
    await start(socket);
  });

  socket.on("transcript", (transcript) => {
    if (transcript !== "")
      captions.innerHTML = transcript ? `<span>${transcript}</span>` : "";
  });
});

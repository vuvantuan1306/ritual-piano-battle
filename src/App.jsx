import { useEffect, useMemo, useRef, useState } from "react";
import { ethers } from "ethers";
import "./App.css";
import ritualLogo from "./assets/ritual-logo.png";
import siggyPiano from "./assets/siggy-piano.png";

const CONTRACT_ADDRESS = "0x7135002F8799EE972a589c66CD77cc19E882A66B";
const RITUAL_RPC_URL = "https://rpc.ritualfoundation.org";
const RITUAL_CHAIN_ID_HEX = "0x7bb";

const SUBMIT_FEE = "0.0001";
const LEVEL_UP_FEE = "0.001";

const TOTAL_QUESTIONS = 10;
const PASSING_CORRECT_COUNT = 5;
const MAX_LEVEL = 7;

const CONTRACT_ABI = [
  "function submitScore(uint256 score,uint256 level,uint256 correct) external payable",
  "function getLeaderboardLength() external view returns (uint256)",
  "function getLeaderboardEntry(uint256 index) external view returns (address player,uint256 score,uint256 level,uint256 correct,uint256 timestamp)",
];

const DIFFICULTIES = {
  easy: {
    label: "Easy",
    seconds: 10,
  },
  normal: {
    label: "Normal",
    seconds: 7,
  },
  hard: {
    label: "Hard",
    seconds: 5,
  },
};

const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

const LEVEL_KEY_CONFIG = {
  1: { white: 7, black: 5, start: "C4", end: "B4" },
  2: { white: 14, black: 10, start: "C3", end: "B4" },
  3: { white: 21, black: 15, start: "C3", end: "B5" },
  4: { white: 28, black: 20, start: "C2", end: "B5" },
  5: { white: 35, black: 25, start: "C2", end: "B6" },
  6: { white: 42, black: 30, start: "C1", end: "B6" },
  7: { white: 52, black: 36, start: "A0", end: "C8" },
};

function createPianoKeys() {
  const keys = [];

  for (let midi = 21; midi <= 108; midi++) {
    const noteIndex = midi % 12;
    const noteName = NOTE_NAMES[noteIndex];
    const octave = Math.floor(midi / 12) - 1;
    const isBlack = noteName.includes("#");
    const frequency = 440 * Math.pow(2, (midi - 69) / 12);

    keys.push({
      midi,
      note: `${noteName}${octave}`,
      label: `${noteName}${octave}`,
      shortLabel: noteName,
      type: isBlack ? "black" : "white",
      frequency,
    });
  }

  return keys;
}

const FULL_PIANO_KEYS = createPianoKeys();

function getMidiByNote(note) {
  const found = FULL_PIANO_KEYS.find((key) => key.note === note);
  return found ? found.midi : 60;
}

function getLevelKeys(level) {
  const config = LEVEL_KEY_CONFIG[level] || LEVEL_KEY_CONFIG[1];
  const startMidi = getMidiByNote(config.start);
  const endMidi = getMidiByNote(config.end);

  return FULL_PIANO_KEYS.filter(
    (key) => key.midi >= startMidi && key.midi <= endMidi
  );
}

function getLevelKeyText(level) {
  const config = LEVEL_KEY_CONFIG[level] || LEVEL_KEY_CONFIG[1];
  return `${config.white} white + ${config.black} black`;
}

function getMonsterNameByLevel(level) {
  if (level === 1) return "Noise Monster";
  if (level === 2) return "Bass Beast";
  if (level === 3) return "Dark Synth";
  if (level === 4) return "Chord Phantom";
  if (level === 5) return "Tempo Wraith";
  if (level === 6) return "Octave Titan";
  return "Ritual Boss";
}

function getMonsterIconByLevel(level) {
  if (level === 1) return "👾";
  if (level === 2) return "👺";
  if (level === 3) return "👹";
  if (level === 4) return "🦇";
  if (level === 5) return "🧛";
  if (level === 6) return "🐉";
  return "🔥";
}

function shortenAddress(address) {
  if (!address) return "";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function getFriendlyError(error) {
  const message = String(
    error?.shortMessage ||
      error?.reason ||
      error?.message ||
      "Transaction failed."
  );

  if (
    message.toLowerCase().includes("user rejected") ||
    message.toLowerCase().includes("rejected") ||
    message.toLowerCase().includes("denied")
  ) {
    return "Transaction rejected in MetaMask.";
  }

  if (message.toLowerCase().includes("insufficient funds")) {
    return "Insufficient RITUAL balance for this transaction.";
  }

  if (message.toLowerCase().includes("switch")) {
    return "Please switch MetaMask to Ritual Testnet.";
  }

  return "Transaction failed. Please try again.";
}

function playPianoSound(frequency, isCorrect) {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;

  const audioContext = new AudioContext();
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();

  oscillator.type = isCorrect ? "sine" : "sawtooth";
  oscillator.frequency.setValueAtTime(frequency || 440, audioContext.currentTime);

  gainNode.gain.setValueAtTime(0.18, audioContext.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(
    0.001,
    audioContext.currentTime + 0.45
  );

  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);

  oscillator.start();
  oscillator.stop(audioContext.currentTime + 0.45);
}

function App() {
  const audioRef = useRef(null);

  const [gameStatus, setGameStatus] = useState("start");
  const [selectedDifficulty, setSelectedDifficulty] = useState("easy");

  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [level, setLevel] = useState(1);
  const [hp, setHp] = useState(3);
  const [currentNote, setCurrentNote] = useState("C4");
  const [notesPlayed, setNotesPlayed] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [message, setMessage] = useState("Hit the right note!");

  const [battleEffect, setBattleEffect] = useState("");
  const [lastPressedNote, setLastPressedNote] = useState("");
  const [floatingText, setFloatingText] = useState("");

  const [timeLeft, setTimeLeft] = useState(DIFFICULTIES.easy.seconds);
  const [isLocked, setIsLocked] = useState(false);

  const [walletAddress, setWalletAddress] = useState("");
  const [walletMessage, setWalletMessage] = useState("");

  const [leaderboard, setLeaderboard] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState("");
  const [hasSubmittedScore, setHasSubmittedScore] = useState(false);

  const [isLevelUpPaying, setIsLevelUpPaying] = useState(false);
  const [levelUpMessage, setLevelUpMessage] = useState("");

  const [isMusicOn, setIsMusicOn] = useState(false);
  const [musicMessage, setMusicMessage] = useState("");

  const difficulty = DIFFICULTIES[selectedDifficulty];
  const timeLimit = difficulty.seconds;
  const monsterName = getMonsterNameByLevel(level);
  const monsterIcon = getMonsterIconByLevel(level);

  const activePianoKeys = useMemo(() => {
    return getLevelKeys(level);
  }, [level]);

  const activeWhiteCount = activePianoKeys.filter(
    (key) => key.type === "white"
  ).length;

  const activeBlackCount = activePianoKeys.filter(
    (key) => key.type === "black"
  ).length;

  useEffect(() => {
    checkConnectedWallet();
    loadOnchainLeaderboard();
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.volume = 0.28;

    async function tryAutoPlay() {
      try {
        await audio.play();
        setIsMusicOn(true);
        setMusicMessage("");
      } catch (error) {
        console.warn("Autoplay blocked by browser:", error);
        setIsMusicOn(false);
        setMusicMessage("Click anywhere to start music");
      }
    }

    async function unlockMusic() {
      const currentAudio = audioRef.current;
      if (!currentAudio) return;

      try {
        currentAudio.volume = 0.28;
        await currentAudio.play();
        setIsMusicOn(true);
        setMusicMessage("");
        removeUnlockEvents();
      } catch (error) {
        console.warn("Music unlock failed:", error);
      }
    }

    function removeUnlockEvents() {
      window.removeEventListener("pointerdown", unlockMusic);
      window.removeEventListener("keydown", unlockMusic);
      window.removeEventListener("touchstart", unlockMusic);
    }

    tryAutoPlay();

    window.addEventListener("pointerdown", unlockMusic);
    window.addEventListener("keydown", unlockMusic);
    window.addEventListener("touchstart", unlockMusic);

    return () => {
      removeUnlockEvents();
    };
  }, []);

  useEffect(() => {
    if (!window.ethereum) return;

    function handleAccountsChanged(accounts) {
      if (accounts.length > 0) {
        setWalletAddress(accounts[0]);
        setWalletMessage("Wallet connected");
      } else {
        setWalletAddress("");
        setWalletMessage("Wallet disconnected");
      }
    }

    window.ethereum.on("accountsChanged", handleAccountsChanged);

    return () => {
      window.ethereum.removeListener("accountsChanged", handleAccountsChanged);
    };
  }, []);

  useEffect(() => {
    if (gameStatus !== "playing") return;
    if (isLocked) return;

    if (timeLeft <= 0) {
      handleTimeOut();
      return;
    }

    const timer = setTimeout(() => {
      setTimeLeft((prev) => prev - 1);
    }, 1000);

    return () => clearTimeout(timer);
  }, [gameStatus, timeLeft, isLocked]);

  function getRandomNoteForLevel(targetLevel) {
    const keys = getLevelKeys(targetLevel);
    const randomKey = keys[Math.floor(Math.random() * keys.length)];
    return randomKey.note;
  }

  async function toggleMusic() {
    const audio = audioRef.current;
    if (!audio) return;

    try {
      audio.volume = 0.28;

      if (isMusicOn) {
        audio.pause();
        setIsMusicOn(false);
        setMusicMessage("Music off");
        return;
      }

      await audio.play();
      setIsMusicOn(true);
      setMusicMessage("");
    } catch (error) {
      console.error(error);
      setMusicMessage("Music file not found or blocked");
    }
  }

  async function checkConnectedWallet() {
    if (!window.ethereum) return;

    try {
      const accounts = await window.ethereum.request({
        method: "eth_accounts",
      });

      if (accounts.length > 0) {
        setWalletAddress(accounts[0]);
        setWalletMessage("Wallet connected");
      }
    } catch (error) {
      console.error(error);
    }
  }

  async function connectWallet() {
    if (!window.ethereum) {
      setWalletMessage("MetaMask not found. Please install MetaMask.");
      return;
    }

    try {
      const accounts = await window.ethereum.request({
        method: "eth_requestAccounts",
      });

      if (accounts.length > 0) {
        setWalletAddress(accounts[0]);
        setWalletMessage("Wallet connected successfully!");
      }
    } catch (error) {
      console.error(error);
      setWalletMessage("Wallet connection rejected.");
    }
  }

  async function switchToRitualNetwork() {
    if (!window.ethereum) return;

    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: RITUAL_CHAIN_ID_HEX }],
      });
    } catch (error) {
      console.error(error);
      throw new Error("Please switch MetaMask to Ritual Testnet.");
    }
  }

  async function loadOnchainLeaderboard() {
    try {
      const provider = new ethers.JsonRpcProvider(RITUAL_RPC_URL);
      const contract = new ethers.Contract(
        CONTRACT_ADDRESS,
        CONTRACT_ABI,
        provider
      );

      const lengthBigInt = await contract.getLeaderboardLength();
      const length = Number(lengthBigInt);
      const limit = Math.min(length, 20);
      const results = [];

      for (let i = length - 1; i >= Math.max(0, length - limit); i--) {
        const entry = await contract.getLeaderboardEntry(i);

        results.push({
          id: `${i}-${entry.player}`,
          player: shortenAddress(entry.player),
          wallet: entry.player,
          score: Number(entry.score),
          level: Number(entry.level),
          correct: Number(entry.correct),
          totalNotes: TOTAL_QUESTIONS,
          result:
            Number(entry.correct) >= PASSING_CORRECT_COUNT ? "win" : "lose",
          date: new Date(Number(entry.timestamp) * 1000).toLocaleString(),
        });
      }

      const sorted = results.sort((a, b) => b.score - a.score).slice(0, 10);
      setLeaderboard(sorted);
    } catch (error) {
      console.error(error);
      setLeaderboard([]);
    }
  }

  async function sendScoreTransaction(paymentAmount, statusSetter) {
    await switchToRitualNetwork();

    const provider = new ethers.BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);

    const tx = await contract.submitScore(score, level, correctCount, {
      value: ethers.parseEther(paymentAmount),
    });

    statusSetter("Transaction submitted. Waiting for confirmation...");

    await tx.wait();
    await loadOnchainLeaderboard();
  }

  async function submitScoreOnchain() {
    if (!window.ethereum) {
      setSubmitMessage("MetaMask not found.");
      return;
    }

    if (!walletAddress) {
      setSubmitMessage("Please connect wallet first.");
      await connectWallet();
      return;
    }

    if (score <= 0) {
      setSubmitMessage("Score must be greater than 0.");
      return;
    }

    try {
      setIsSubmitting(true);
      setSubmitMessage(`Submitting score for ${SUBMIT_FEE} RITUAL...`);

      await sendScoreTransaction(SUBMIT_FEE, setSubmitMessage);

      setHasSubmittedScore(true);
      setSubmitMessage("Score submitted on-chain successfully!");
    } catch (error) {
      console.error(error);
      setSubmitMessage(getFriendlyError(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function payLevelUpFeeAndGoNext() {
    if (!window.ethereum) {
      setLevelUpMessage("MetaMask not found.");
      return;
    }

    if (!walletAddress) {
      setLevelUpMessage("Please connect wallet first.");
      await connectWallet();
      return;
    }

    if (correctCount < PASSING_CORRECT_COUNT) {
      setLevelUpMessage(
        `You need at least ${PASSING_CORRECT_COUNT}/${TOTAL_QUESTIONS} correct answers to unlock the next level.`
      );
      return;
    }

    if (level >= MAX_LEVEL) {
      setLevelUpMessage("You already completed the final level.");
      return;
    }

    try {
      setIsLevelUpPaying(true);
      setLevelUpMessage(
        `Paying ${LEVEL_UP_FEE} RITUAL, saving score, and unlocking Level ${
          level + 1
        }...`
      );

      await sendScoreTransaction(LEVEL_UP_FEE, setLevelUpMessage);

      setHasSubmittedScore(true);
      setLevelUpMessage(`Score saved. Level ${level + 1} unlocked!`);

      setTimeout(() => {
        nextLevel();
      }, 700);
    } catch (error) {
      console.error(error);
      setLevelUpMessage(getFriendlyError(error));
    } finally {
      setIsLevelUpPaying(false);
    }
  }

  function resetBattleState(nextLevel = 1) {
    setGameStatus("playing");
    setCombo(0);
    setLevel(nextLevel);
    setHp(3);
    setNotesPlayed(0);
    setCorrectCount(0);
    setCurrentNote(getRandomNoteForLevel(nextLevel));
    setMessage(`Level ${nextLevel} started!`);
    setBattleEffect("");
    setLastPressedNote("");
    setFloatingText("");
    setTimeLeft(timeLimit);
    setIsLocked(false);
    setSubmitMessage("");
    setLevelUpMessage("");
    setHasSubmittedScore(false);
  }

  function startGame() {
    setScore(0);
    resetBattleState(1);
  }

  function nextLevel() {
    const newLevel = level + 1;
    resetBattleState(newLevel);
  }

  function triggerEffect(effectName, text) {
    setBattleEffect(effectName);
    setFloatingText(text);

    setTimeout(() => {
      setBattleEffect("");
      setFloatingText("");
    }, 450);
  }

  function goNextNote() {
    setCurrentNote(getRandomNoteForLevel(level));
    setTimeLeft(timeLimit);
    setLastPressedNote("");
    setIsLocked(false);
  }

  function finishRound(finalCorrectCount) {
    if (finalCorrectCount >= PASSING_CORRECT_COUNT) {
      if (level >= MAX_LEVEL) {
        setGameStatus("complete");
      } else {
        setGameStatus("win");
      }
    } else {
      setGameStatus("lose");
    }
  }

  function handleTimeOut() {
    if (gameStatus !== "playing") return;
    if (isLocked) return;

    setIsLocked(true);

    const nextNotesPlayed = notesPlayed + 1;
    const nextHp = Math.max(0, hp - 1);

    setScore((prev) => Math.max(0, prev - 5));
    setCombo(0);
    setHp(nextHp);
    setNotesPlayed(nextNotesPlayed);
    setMessage("Too slow! The monster attacks!");
    triggerEffect("wrong", "TIME OUT -5");

    if (nextNotesPlayed >= TOTAL_QUESTIONS) {
      setTimeout(() => {
        finishRound(correctCount);
      }, 500);
      return;
    }

    setTimeout(() => {
      goNextNote();
    }, 650);
  }

  function handleNoteClick(note) {
    if (gameStatus !== "playing") return;
    if (isLocked) return;

    setIsLocked(true);
    setLastPressedNote(note);

    const nextNotesPlayed = notesPlayed + 1;
    const pressedKey = activePianoKeys.find((key) => key.note === note);
    const isCorrect = note === currentNote;
    const nextCorrectCount = correctCount + (isCorrect ? 1 : 0);
    const pointReward = 10 * level;

    playPianoSound(pressedKey?.frequency || 440, isCorrect);

    if (isCorrect) {
      setScore((prev) => prev + pointReward);
      setCombo((prev) => prev + 1);
      setCorrectCount(nextCorrectCount);
      setMessage("Perfect! Sound wave attack!");
      triggerEffect("correct", `+${pointReward} PERFECT`);
    } else {
      const nextHp = Math.max(0, hp - 1);

      setScore((prev) => Math.max(0, prev - 5));
      setCombo(0);
      setHp(nextHp);
      setMessage("Miss! The monster attacks!");
      triggerEffect("wrong", "MISS -5");
    }

    setNotesPlayed(nextNotesPlayed);

    if (nextNotesPlayed >= TOTAL_QUESTIONS) {
      setTimeout(() => {
        finishRound(nextCorrectCount);
      }, 500);
      return;
    }

    setTimeout(() => {
      goNextNote();
    }, 650);
  }

  function backHome() {
    setGameStatus("start");
    setSubmitMessage("");
    setLevelUpMessage("");
  }

  async function openLeaderboard() {
    await loadOnchainLeaderboard();
    setGameStatus("leaderboard");
  }

  const timePercent = (timeLeft / timeLimit) * 100;
  const connectedWalletText = walletAddress
    ? shortenAddress(walletAddress)
    : "Connect Wallet";

  const soundButtonStyle = {
    position: "fixed",
    top: "18px",
    right: "18px",
    zIndex: 9999,
    width: "48px",
    height: "48px",
    borderRadius: "999px",
    display: "grid",
    placeItems: "center",
    fontSize: "22px",
    color: "#ffffff",
    background: isMusicOn
      ? "linear-gradient(135deg, #23e6ff, #8f5cff)"
      : "rgba(10, 13, 34, 0.88)",
    border: "1px solid rgba(141, 247, 255, 0.28)",
    boxShadow: isMusicOn
      ? "0 0 24px rgba(35, 230, 255, 0.45)"
      : "0 0 18px rgba(0, 0, 0, 0.28)",
  };

  const musicMessageStyle = {
    position: "fixed",
    top: "72px",
    right: "18px",
    zIndex: 9999,
    padding: "8px 12px",
    borderRadius: "999px",
    fontSize: "12px",
    fontWeight: 800,
    color: "#8df7ff",
    background: "rgba(10, 13, 34, 0.82)",
    border: "1px solid rgba(141, 247, 255, 0.16)",
  };

  const siggyAvatarStyle = {
    width: "112px",
    height: "112px",
    borderRadius: "24px",
    objectFit: "cover",
    objectPosition: "28% 26%",
    display: "block",
    margin: "0 auto 18px",
    boxShadow: "0 0 28px rgba(111, 94, 255, 0.35)",
    border: "1px solid rgba(141, 247, 255, 0.22)",
    background: "rgba(14, 16, 40, 0.72)",
  };

  const difficultyPanelStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: "12px",
    maxWidth: "520px",
    margin: "0 0 24px",
  };

  const getDifficultyButtonStyle = (difficultyKey) => ({
    padding: "14px 12px",
    borderRadius: "18px",
    color: selectedDifficulty === difficultyKey ? "#07111e" : "#ffffff",
    background:
      selectedDifficulty === difficultyKey
        ? "linear-gradient(135deg, #8df7ff, #ffcf62)"
        : "rgba(10, 17, 44, 0.86)",
    border:
      selectedDifficulty === difficultyKey
        ? "1px solid rgba(255, 255, 255, 0.45)"
        : "1px solid rgba(141, 247, 255, 0.18)",
    boxShadow:
      selectedDifficulty === difficultyKey
        ? "0 0 22px rgba(141, 247, 255, 0.35)"
        : "none",
    fontWeight: 900,
  });

  return (
    <main className={`app ${battleEffect === "wrong" ? "screen-shake" : ""}`}>
      <audio
        ref={audioRef}
        src="/music/background.mp3"
        loop
        preload="auto"
        autoPlay
      />

      <button
        type="button"
        style={soundButtonStyle}
        onClick={toggleMusic}
        title={isMusicOn ? "Turn music off" : "Turn music on"}
      >
        {isMusicOn ? "🔊" : "🔇"}
      </button>

      {musicMessage && <div style={musicMessageStyle}>{musicMessage}</div>}

      {gameStatus === "start" && (
        <section className="start-screen home-screen">
          <div className="hero-card home-hero-card">
            <div className="home-topbar">
              <div className="home-brand">
                <img src={ritualLogo} alt="Ritual Logo" className="ritual-logo" />
                <span className="brand-text">RITUAL</span>
              </div>

              <div className="top-nav">
                <button className="nav-link" onClick={() => setGameStatus("howto")}>
                  How to Play
                </button>

                <button className="nav-link" onClick={openLeaderboard}>
                  Leaderboard
                </button>

                <button className="nav-link" onClick={() => setGameStatus("about")}>
                  About
                </button>

                <a
                  className="nav-link nav-anchor"
                  href="https://faucet.ritualfoundation.org/"
                  target="_blank"
                  rel="noreferrer"
                >
                  Faucet
                </a>
              </div>

              <button className="connect-wallet-top" onClick={connectWallet}>
                {connectedWalletText}
              </button>
            </div>

            {walletMessage && <p className="wallet-status-top">{walletMessage}</p>}

            <div className="home-hero-content">
              <div className="home-left">
                <div className="game-tag">🎮 WEB3 ARCADE MINI GAME</div>

                <h1 className="home-title">
                  <span className="title-main">RITUAL</span>
                  <span className="title-sub">PIANO BATTLE</span>
                </h1>

                <p className="home-subtitle">
                  Choose your mode, hit the right notes, clear 7 levels, and
                  submit your score on-chain.
                </p>

                <div style={difficultyPanelStyle}>
                  <button
                    type="button"
                    style={getDifficultyButtonStyle("easy")}
                    onClick={() => setSelectedDifficulty("easy")}
                  >
                    Easy
                    <br />
                    <span style={{ fontSize: "12px", fontWeight: 700 }}>
                      10s / question
                    </span>
                  </button>

                  <button
                    type="button"
                    style={getDifficultyButtonStyle("normal")}
                    onClick={() => setSelectedDifficulty("normal")}
                  >
                    Normal
                    <br />
                    <span style={{ fontSize: "12px", fontWeight: 700 }}>
                      7s / question
                    </span>
                  </button>

                  <button
                    type="button"
                    style={getDifficultyButtonStyle("hard")}
                    onClick={() => setSelectedDifficulty("hard")}
                  >
                    Hard
                    <br />
                    <span style={{ fontSize: "12px", fontWeight: 700 }}>
                      5s / question
                    </span>
                  </button>
                </div>

                <div className="home-action-buttons">
                  <button className="play-now-big" onClick={startGame}>
                    ▶ PLAY NOW
                  </button>

                  <button className="leaderboard-big" onClick={openLeaderboard}>
                    🏆 LEADERBOARD
                  </button>
                </div>
              </div>

              <div className="home-right">
                <div className="siggy-stage">
                  <img
                    src={siggyPiano}
                    alt="Siggy playing Ritual piano"
                    className="siggy-hero-image"
                  />
                </div>
              </div>
            </div>

            <div className="home-bottom-strip">
              <div className="bottom-item">
                <strong>🎮 3 Game Modes</strong>
                <span>Easy / Normal / Hard</span>
              </div>

              <div className="bottom-item">
                <strong>🎹 7 Levels</strong>
                <span>From 12 keys to full 88 keys</span>
              </div>

              <div className="bottom-item">
                <strong>⚡ Level Fee</strong>
                <span>0.001 RITUAL to unlock next level</span>
              </div>

              <div className="bottom-item">
                <strong>💎 Web3 Powered</strong>
                <span>On Ritual Testnet</span>
              </div>
            </div>

            <div
              className="creator-box"
              style={{
                position: "relative",
                zIndex: 1,
                margin: "18px auto 0",
                justifyContent: "center",
              }}
            >
              <span>Created by </span>
              <a
                href="https://x.com/vuvantuan1306"
                target="_blank"
                rel="noreferrer"
              >
                vuvantuan1306
              </a>
            </div>
          </div>
        </section>
      )}

      {gameStatus === "howto" && (
        <section className="result-screen">
          <div className="result-card info-card">
            <p className="tag">How to Play</p>
            <h2>Ritual Piano Battle</h2>

            <div className="info-list">
              <div>
                <strong>1. Choose Your Mode</strong>
                <span>
                  Easy gives 10 seconds per question, Normal gives 7 seconds, and
                  Hard gives 5 seconds.
                </span>
              </div>

              <div>
                <strong>2. Clear 7 Levels</strong>
                <span>
                  Level 1 starts with one octave. Level 7 unlocks the full 88-key piano.
                </span>
              </div>

              <div>
                <strong>3. Answer 10 Questions</strong>
                <span>
                  Each level has 10 questions. Get at least 5 correct answers to
                  clear the level.
                </span>
              </div>

              <div>
                <strong>4. Save Score & Unlock Next Level</strong>
                <span>
                  When you pass a level, paying 0.001 RITUAL saves your score
                  on-chain and unlocks the next level.
                </span>
              </div>

              <div>
                <strong>5. Cumulative Score</strong>
                <span>
                  Your score keeps increasing across levels until you restart from Level 1.
                </span>
              </div>
            </div>

            <button onClick={startGame}>Play Now</button>
            <button className="secondary" onClick={backHome}>
              Back Home
            </button>
          </div>
        </section>
      )}

      {gameStatus === "about" && (
        <section className="result-screen">
          <div className="result-card info-card">
            <p className="tag">About</p>
            <h2>Web3 Piano Arcade</h2>

            <p>
              Ritual Piano Battle is a Web3 arcade mini game where players choose
              a difficulty mode, hit piano notes, build combos, clear 7 levels, and
              submit scores on-chain.
            </p>

            <p>
              The game uses Ritual Testnet, wallet connection, level-up payments,
              cumulative score progress, on-chain score submission, and a leaderboard
              powered by a smart contract.
            </p>

            <a
              className="about-link"
              href="https://faucet.ritualfoundation.org/"
              target="_blank"
              rel="noreferrer"
            >
              Get testnet RITUAL
            </a>

            <a
              className="about-link"
              href="https://x.com/vuvantuan1306"
              target="_blank"
              rel="noreferrer"
            >
              Created by vuvantuan1306
            </a>

            <button onClick={backHome}>Back Home</button>
          </div>
        </section>
      )}

      {gameStatus === "leaderboard" && (
        <section className="result-screen">
          <div className="result-card leaderboard-card">
            <p className="tag">On-chain Scores</p>
            <h2>Leaderboard</h2>

            {leaderboard.length === 0 ? (
              <p className="empty-leaderboard">
                No on-chain scores yet. Play and submit your score.
              </p>
            ) : (
              <div className="leaderboard-list">
                {leaderboard.map((entry, index) => (
                  <div className="leaderboard-row" key={entry.id}>
                    <div className="rank">#{index + 1}</div>

                    <div className="player-info">
                      <strong>{entry.player}</strong>
                      <span>
                        Level {entry.level} • {entry.correct}/{entry.totalNotes} correct •{" "}
                        {entry.result === "win" ? "Win" : "Lose"}
                      </span>
                    </div>

                    <div className="leader-score">{entry.score}</div>
                  </div>
                ))}
              </div>
            )}

            <button onClick={loadOnchainLeaderboard}>Refresh</button>
            <button className="secondary" onClick={backHome}>
              Back Home
            </button>
          </div>
        </section>
      )}

      {gameStatus === "playing" && (
        <section className="game-screen">
          <header className="battle-stats">
            <div>Mode: {difficulty.label}</div>
            <div>HP: {"❤️".repeat(hp)}</div>
            <div>Score: {score}</div>
            <div className={combo >= 3 ? "combo-hot" : ""}>Combo: x{combo}</div>
            <div>Level: {level}/{MAX_LEVEL}</div>

            <div>
              Keys: {activeWhiteCount}W + {activeBlackCount}B
            </div>

            <div>Notes: {notesPlayed}/{TOTAL_QUESTIONS}</div>

            <div className={timeLeft <= 2 ? "time-danger" : ""}>
              Time: {timeLeft}s
            </div>

            <div>
              Wallet: {walletAddress ? shortenAddress(walletAddress) : "Not connected"}
            </div>
          </header>

          <div className="level-info">
            {difficulty.label} Mode • Level {level}/{MAX_LEVEL} • {monsterName} •{" "}
            {getLevelKeyText(level)} • Reward: +{10 * level} / note • Need{" "}
            {PASSING_CORRECT_COUNT}/{TOTAL_QUESTIONS} correct
          </div>

          <div className="timer-bar">
            <div
              className={`timer-fill ${timeLeft <= 2 ? "danger-fill" : ""}`}
              style={{ width: `${timePercent}%` }}
            />
          </div>

          <section className={`battle-field ${battleEffect}`}>
            <div className="player-card">
              <img src={siggyPiano} alt="Siggy" style={siggyAvatarStyle} />
              <p>Siggy</p>
              <p className="small-label">Music Fighter</p>
            </div>

            <div className="note-zone">
              <p className="message">{message}</p>

              {floatingText && (
                <div
                  className={`floating-text ${
                    battleEffect === "correct" ? "good-text" : "bad-text"
                  }`}
                >
                  {floatingText}
                </div>
              )}

              <div className="falling-note">{currentNote}</div>

              <div className="sound-wave">〰️〰️〰️</div>

              {combo >= 3 && <div className="combo-banner">COMBO x{combo}</div>}
            </div>

            <div className="monster-card">
              <div className="character monster-character">{monsterIcon}</div>
              <p>{monsterName}</p>
              <p className="small-label">Dark Sound</p>
            </div>
          </section>

          <section className="piano">
            {activePianoKeys.map((key) => (
              <button
                key={key.note}
                className={`piano-key ${key.type}-key ${
                  lastPressedNote === key.note ? "active-key" : ""
                }`}
                onClick={() => handleNoteClick(key.note)}
                title={key.note}
              >
                {level === 1 ? key.shortLabel : key.label}
              </button>
            ))}
          </section>
        </section>
      )}

      {gameStatus === "win" && (
        <section className="result-screen">
          <div className="result-card win-card">
            <h2>LEVEL CLEAR!</h2>
            <p>{difficulty.label} Mode</p>
            <p>Level {level}/{MAX_LEVEL} completed</p>
            <p>{getLevelKeyText(level)}</p>
            <p>Cumulative Score: {score}</p>
            <p>
              Correct: {correctCount}/{TOTAL_QUESTIONS}
            </p>
            <p>Combo: x{combo}</p>
            <p>
              Wallet: {walletAddress ? shortenAddress(walletAddress) : "Not connected"}
            </p>

            <button onClick={payLevelUpFeeAndGoNext} disabled={isLevelUpPaying}>
              {isLevelUpPaying
                ? "Processing..."
                : `Pay ${LEVEL_UP_FEE} RITUAL, Save Score & Unlock Level ${
                    level + 1
                  }`}
            </button>

            {levelUpMessage && <p>{levelUpMessage}</p>}

            <button className="secondary" onClick={openLeaderboard}>
              View Leaderboard
            </button>

            <button className="secondary" onClick={startGame}>
              Restart From Level 1
            </button>

            <button className="secondary" onClick={backHome}>
              Back Home
            </button>
          </div>
        </section>
      )}

      {gameStatus === "complete" && (
        <section className="result-screen">
          <div className="result-card win-card">
            <h2>GAME COMPLETED!</h2>
            <p>You cleared all 7 levels in {difficulty.label} Mode.</p>
            <p>Final Cumulative Score: {score}</p>
            <p>
              Correct: {correctCount}/{TOTAL_QUESTIONS} on final level
            </p>
            <p>
              Wallet: {walletAddress ? shortenAddress(walletAddress) : "Not connected"}
            </p>

            <button
              onClick={submitScoreOnchain}
              disabled={isSubmitting || hasSubmittedScore}
            >
              {hasSubmittedScore
                ? "Submitted On-chain"
                : isSubmitting
                ? "Submitting..."
                : `Submit Final Score (${SUBMIT_FEE} RITUAL)`}
            </button>

            {submitMessage && <p>{submitMessage}</p>}

            <button className="secondary" onClick={openLeaderboard}>
              View Leaderboard
            </button>

            <button className="secondary" onClick={startGame}>
              Play Again
            </button>

            <button className="secondary" onClick={backHome}>
              Back Home
            </button>
          </div>
        </section>
      )}

      {gameStatus === "lose" && (
        <section className="result-screen">
          <div className="result-card lose-card">
            <h2>BATTLE LOST</h2>
            <p>{monsterName} wins...</p>
            <p>{difficulty.label} Mode</p>
            <p>Level: {level}/{MAX_LEVEL}</p>
            <p>{getLevelKeyText(level)}</p>
            <p>Cumulative Score: {score}</p>
            <p>
              Correct: {correctCount}/{TOTAL_QUESTIONS}
            </p>
            <p>
              Need at least {PASSING_CORRECT_COUNT}/{TOTAL_QUESTIONS} correct to clear
              the level.
            </p>
            <p>
              Wallet: {walletAddress ? shortenAddress(walletAddress) : "Not connected"}
            </p>

            <button
              onClick={submitScoreOnchain}
              disabled={isSubmitting || hasSubmittedScore}
            >
              {hasSubmittedScore
                ? "Submitted On-chain"
                : isSubmitting
                ? "Submitting..."
                : `Submit Score (${SUBMIT_FEE} RITUAL)`}
            </button>

            {submitMessage && <p>{submitMessage}</p>}

            <button className="secondary" onClick={() => resetBattleState(level)}>
              Try This Level Again
            </button>

            <button className="secondary" onClick={openLeaderboard}>
              View Leaderboard
            </button>

            <button className="secondary" onClick={startGame}>
              Restart From Level 1
            </button>

            <button className="secondary" onClick={backHome}>
              Back Home
            </button>
          </div>
        </section>
      )}
    </main>
  );
}

export default App;
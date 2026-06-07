import { useEffect, useState } from "react";
import { ethers } from "ethers";
import "./App.css";

const CONTRACT_ADDRESS = "0x7135002F8799EE972a589c66CD77cc19E882A66B";
const RITUAL_RPC_URL = "https://rpc.ritualfoundation.org";
const RITUAL_CHAIN_ID_HEX = "0x7bb";
const SUBMIT_FEE = "0.0001";

const CONTRACT_ABI = [
  "function submitScore(uint256 score,uint256 level,uint256 correct) external payable",
  "function getLeaderboardLength() external view returns (uint256)",
  "function getLeaderboardEntry(uint256 index) external view returns (address player,uint256 score,uint256 level,uint256 correct,uint256 timestamp)",
];

const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const PIANO_KEYS = [
  { note: "C", type: "white" },
  { note: "C#", type: "black" },
  { note: "D", type: "white" },
  { note: "D#", type: "black" },
  { note: "E", type: "white" },
  { note: "F", type: "white" },
  { note: "F#", type: "black" },
  { note: "G", type: "white" },
  { note: "G#", type: "black" },
  { note: "A", type: "white" },
  { note: "A#", type: "black" },
  { note: "B", type: "white" },
];

const NOTE_FREQUENCIES = {
  C: 261.63,
  "C#": 277.18,
  D: 293.66,
  "D#": 311.13,
  E: 329.63,
  F: 349.23,
  "F#": 369.99,
  G: 392.0,
  "G#": 415.3,
  A: 440.0,
  "A#": 466.16,
  B: 493.88,
};

function getTimeLimitByLevel(level) {
  if (level === 1) return 5;
  if (level === 2) return 4;
  if (level === 3) return 3;
  return 2;
}

function getMonsterNameByLevel(level) {
  if (level === 1) return "Noise Monster";
  if (level === 2) return "Bass Beast";
  if (level === 3) return "Dark Synth";
  return "Ritual Boss";
}

function shortenAddress(address) {
  if (!address) return "";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function playPianoSound(note, isCorrect) {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;

  const audioContext = new AudioContext();
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();

  oscillator.type = isCorrect ? "sine" : "sawtooth";
  oscillator.frequency.setValueAtTime(
    NOTE_FREQUENCIES[note] || 440,
    audioContext.currentTime
  );

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
  const [gameStatus, setGameStatus] = useState("start");
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [level, setLevel] = useState(1);
  const [hp, setHp] = useState(3);
  const [currentNote, setCurrentNote] = useState("G");
  const [notesPlayed, setNotesPlayed] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [message, setMessage] = useState("Hit the right note!");

  const [battleEffect, setBattleEffect] = useState("");
  const [lastPressedNote, setLastPressedNote] = useState("");
  const [floatingText, setFloatingText] = useState("");

  const [timeLeft, setTimeLeft] = useState(5);
  const [isLocked, setIsLocked] = useState(false);

  const [walletAddress, setWalletAddress] = useState("");
  const [walletMessage, setWalletMessage] = useState("");

  const [leaderboard, setLeaderboard] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState("");
  const [hasSubmittedScore, setHasSubmittedScore] = useState(false);

  const timeLimit = getTimeLimitByLevel(level);
  const monsterName = getMonsterNameByLevel(level);

  useEffect(() => {
    checkConnectedWallet();
    loadOnchainLeaderboard();
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
          totalNotes: 10,
          result: Number(entry.correct) >= 6 ? "win" : "lose",
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
      setSubmitMessage("Waiting for MetaMask...");

      await switchToRitualNetwork();

      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(
        CONTRACT_ADDRESS,
        CONTRACT_ABI,
        signer
      );

      const tx = await contract.submitScore(score, level, correctCount, {
        value: ethers.parseEther(SUBMIT_FEE),
      });

      setSubmitMessage("Transaction submitted. Waiting confirmation...");

      await tx.wait();

      setHasSubmittedScore(true);
      setSubmitMessage("Score submitted on-chain successfully!");
      await loadOnchainLeaderboard();
    } catch (error) {
      console.error(error);
      setSubmitMessage(error?.message || "Submit failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function randomNote() {
    return NOTES[Math.floor(Math.random() * NOTES.length)];
  }

  function resetBattleState(nextLevel = 1) {
    const nextTimeLimit = getTimeLimitByLevel(nextLevel);

    setGameStatus("playing");
    setCombo(0);
    setLevel(nextLevel);
    setHp(3);
    setNotesPlayed(0);
    setCorrectCount(0);
    setCurrentNote(randomNote());
    setMessage(`Level ${nextLevel} started!`);
    setBattleEffect("");
    setLastPressedNote("");
    setFloatingText("");
    setTimeLeft(nextTimeLimit);
    setIsLocked(false);
    setSubmitMessage("");
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
    setCurrentNote(randomNote());
    setTimeLeft(getTimeLimitByLevel(level));
    setLastPressedNote("");
    setIsLocked(false);
  }

  function finishRound(nextCorrectCount) {
    if (nextCorrectCount >= 6) {
      setGameStatus("win");
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

    if (nextHp <= 0) {
      setTimeout(() => {
        setGameStatus("lose");
      }, 500);
      return;
    }

    if (nextNotesPlayed >= 10) {
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
    const isCorrect = note === currentNote;
    const nextCorrectCount = correctCount + (isCorrect ? 1 : 0);
    const pointReward = 10 * level;

    playPianoSound(note, isCorrect);

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

      if (nextHp <= 0) {
        setNotesPlayed(nextNotesPlayed);
        setTimeout(() => {
          setGameStatus("lose");
        }, 500);
        return;
      }
    }

    setNotesPlayed(nextNotesPlayed);

    if (nextNotesPlayed >= 10) {
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
  }

  async function openLeaderboard() {
    await loadOnchainLeaderboard();
    setGameStatus("leaderboard");
  }

  const timePercent = (timeLeft / timeLimit) * 100;
  const connectedWalletText = walletAddress
    ? shortenAddress(walletAddress)
    : "Connect Wallet";

  return (
    <main className={`app ${battleEffect === "wrong" ? "screen-shake" : ""}`}>
      {gameStatus === "start" && (
        <section className="start-screen">
          <div className="hero-card">
            <p className="tag">Web3 Arcade Mini Game</p>
            <h1>Ritual Piano Battle</h1>
            <p className="subtitle">
              Hit the right notes, build combos, and defeat the noise monster.
            </p>

            <div className="wallet-box">
              <button className="wallet-button" onClick={connectWallet}>
                {connectedWalletText}
              </button>
              {walletMessage && <p>{walletMessage}</p>}
            </div>

            <div className="level-preview">
              <span>Level 1: 5s</span>
              <span>Level 2: 4s</span>
              <span>Level 3: 3s</span>
              <span>Level 4+: 2s</span>
            </div>

            <div className="menu-buttons">
              <button onClick={startGame}>Play Now</button>
              <button className="secondary" onClick={openLeaderboard}>
                Leaderboard
              </button>
            </div>

            <p className="daily-quest">
              Submit score fee: 0.0001 RITUAL testnet
            </p>
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
            <div>HP: {"❤️".repeat(hp)}</div>
            <div>Score: {score}</div>
            <div className={combo >= 3 ? "combo-hot" : ""}>Combo: x{combo}</div>
            <div>Level: {level}</div>
            <div>Notes: {notesPlayed}/10</div>
            <div className={timeLeft <= 2 ? "time-danger" : ""}>
              Time: {timeLeft}s
            </div>
            <div>
              Wallet: {walletAddress ? shortenAddress(walletAddress) : "Not connected"}
            </div>
          </header>

          <div className="level-info">
            Level {level} • {monsterName} • Reward: +{10 * level} / note
          </div>

          <div className="timer-bar">
            <div
              className={`timer-fill ${timeLeft <= 2 ? "danger-fill" : ""}`}
              style={{ width: `${timePercent}%` }}
            />
          </div>

          <section className={`battle-field ${battleEffect}`}>
            <div className="player-card">
              <div className="character player-character">😼</div>
              <p>Ritual Cat</p>
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

              {combo >= 3 && (
                <div className="combo-banner">COMBO x{combo}</div>
              )}
            </div>

            <div className="monster-card">
              <div className="character monster-character">
                {level >= 4 ? "🐉" : level === 3 ? "👹" : level === 2 ? "👺" : "👾"}
              </div>
              <p>{monsterName}</p>
              <p className="small-label">Dark Sound</p>
            </div>
          </section>

          <section className="piano">
            {PIANO_KEYS.map((key) => (
              <button
                key={key.note}
                className={`piano-key ${key.type}-key ${
                  lastPressedNote === key.note ? "active-key" : ""
                }`}
                onClick={() => handleNoteClick(key.note)}
              >
                {key.note}
              </button>
            ))}
          </section>
        </section>
      )}

      {gameStatus === "win" && (
        <section className="result-screen">
          <div className="result-card win-card">
            <h2>LEVEL CLEAR!</h2>
            <p>Level {level} completed</p>
            <p>Score: {score}</p>
            <p>Correct: {correctCount}/10</p>
            <p>Combo: x{combo}</p>
            <p>
              Wallet: {walletAddress ? shortenAddress(walletAddress) : "Not connected"}
            </p>

            <button onClick={submitScoreOnchain} disabled={isSubmitting || hasSubmittedScore}>
              {hasSubmittedScore
                ? "Submitted On-chain"
                : isSubmitting
                ? "Submitting..."
                : "Submit Score On-chain"}
            </button>

            {submitMessage && <p>{submitMessage}</p>}

            <button className="secondary" onClick={nextLevel}>
              Next Level
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

      {gameStatus === "lose" && (
        <section className="result-screen">
          <div className="result-card lose-card">
            <h2>BATTLE LOST</h2>
            <p>{monsterName} wins...</p>
            <p>Level: {level}</p>
            <p>Score: {score}</p>
            <p>Correct: {correctCount}/10</p>
            <p>
              Wallet: {walletAddress ? shortenAddress(walletAddress) : "Not connected"}
            </p>

            <button onClick={submitScoreOnchain} disabled={isSubmitting || hasSubmittedScore}>
              {hasSubmittedScore
                ? "Submitted On-chain"
                : isSubmitting
                ? "Submitting..."
                : "Submit Score On-chain"}
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
export type RunStatus = "active" | "lost";

export interface Candidate {
  id: string;
  animalName: string;
  statement: string;
}

export interface RoundView {
  roundId: string;
  difficulty: number;
  candidates: Candidate[];
}

interface RoundInternal extends RoundView {
  imposterCandidateId: string;
  explanation: string;
}

interface RunInternal {
  runId: string;
  topic: string;
  score: number;
  roundNumber: number;
  status: RunStatus;
  currentRound: RoundInternal;
}

export interface RunCreatedResponse {
  runId: string;
  topic: string;
  roundNumber: number;
  score: number;
  status: "active";
  round: RoundView;
}

export interface CorrectAnswerResponse {
  correct: true;
  status: "active";
  score: number;
  roundNumber: number;
  round: RoundView;
}

export interface WrongAnswerResponse {
  correct: false;
  status: "lost";
  score: number;
  roundNumber: number;
  reveal: {
    correctImposterCandidateId: string;
    explanation: string;
  };
}

export type SubmitAnswerResponse = CorrectAnswerResponse | WrongAnswerResponse;

interface RoundTemplate {
  imposterCandidateId: string;
  explanation: string;
  candidates: Candidate[];
}

const planetTemplates: RoundTemplate[] = [
  {
    imposterCandidateId: "rabbit",
    explanation: "Venus is not the farthest planet from the Sun.",
    candidates: [
      { id: "pig", animalName: "Pig", statement: "Mercury is closest to the Sun." },
      { id: "cat", animalName: "Cat", statement: "Earth has one moon." },
      { id: "bull", animalName: "Bull", statement: "Jupiter is the largest planet." },
      {
        id: "rabbit",
        animalName: "Rabbit",
        statement: "Venus is the farthest planet from the Sun."
      },
      { id: "dog", animalName: "Dog", statement: "Mars is known as the red planet." }
    ]
  },
  {
    imposterCandidateId: "cat",
    explanation: "Saturn is not the only planet with rings.",
    candidates: [
      {
        id: "pig",
        animalName: "Pig",
        statement: "Neptune takes about 165 Earth years to orbit the Sun."
      },
      {
        id: "cat",
        animalName: "Cat",
        statement: "Saturn is the only planet with rings."
      },
      {
        id: "bull",
        animalName: "Bull",
        statement: "Venus is usually hotter than Mercury on average."
      },
      {
        id: "rabbit",
        animalName: "Rabbit",
        statement: "Mars has two moons called Phobos and Deimos."
      },
      {
        id: "dog",
        animalName: "Dog",
        statement: "Uranus rotates with an extreme axial tilt."
      }
    ]
  },
  {
    imposterCandidateId: "bull",
    explanation: "Pluto is classified as a dwarf planet, not a major planet.",
    candidates: [
      {
        id: "pig",
        animalName: "Pig",
        statement: "Jupiter's Great Red Spot is a giant storm."
      },
      {
        id: "cat",
        animalName: "Cat",
        statement: "Venus rotates in the opposite direction to most planets."
      },
      {
        id: "bull",
        animalName: "Bull",
        statement: "Pluto is currently classified as a major planet."
      },
      {
        id: "rabbit",
        animalName: "Rabbit",
        statement: "Mercury has a much shorter year than Earth."
      },
      {
        id: "dog",
        animalName: "Dog",
        statement: "Saturn has many moons, including Titan."
      }
    ]
  }
];

function toPublicRound(round: RoundInternal): RoundView {
  return {
    roundId: round.roundId,
    difficulty: round.difficulty,
    candidates: round.candidates
  };
}

export class GameService {
  private readonly runs = new Map<string, RunInternal>();
  private runCounter = 0;

  createRun(topic: string): RunCreatedResponse {
    const normalizedTopic = topic.trim() || "planets";
    const runId = `run_${++this.runCounter}`;
    const roundNumber = 1;

    const currentRound = this.buildRound(normalizedTopic, roundNumber);

    const run: RunInternal = {
      runId,
      topic: normalizedTopic,
      score: 0,
      roundNumber,
      status: "active",
      currentRound
    };

    this.runs.set(runId, run);

    return {
      runId: run.runId,
      topic: run.topic,
      roundNumber: run.roundNumber,
      score: run.score,
      status: "active",
      round: toPublicRound(run.currentRound)
    };
  }

  submitAnswer(runId: string, candidateId: string): SubmitAnswerResponse {
    const run = this.runs.get(runId);
    if (!run) {
      throw new Error("RUN_NOT_FOUND");
    }

    if (run.status !== "active") {
      throw new Error("RUN_NOT_ACTIVE");
    }

    const normalizedCandidateId = candidateId.trim().toLowerCase();
    if (!normalizedCandidateId) {
      throw new Error("INVALID_CANDIDATE_ID");
    }

    if (normalizedCandidateId !== run.currentRound.imposterCandidateId) {
      run.status = "lost";

      return {
        correct: false,
        status: "lost",
        score: run.score,
        roundNumber: run.roundNumber,
        reveal: {
          correctImposterCandidateId: run.currentRound.imposterCandidateId,
          explanation: run.currentRound.explanation
        }
      };
    }

    run.score += 1;
    run.roundNumber += 1;
    run.currentRound = this.buildRound(run.topic, run.roundNumber);

    return {
      correct: true,
      status: "active",
      score: run.score,
      roundNumber: run.roundNumber,
      round: toPublicRound(run.currentRound)
    };
  }

  private buildRound(topic: string, roundNumber: number): RoundInternal {
    if (topic.toLowerCase() !== "planets") {
      return this.buildGenericRound(topic, roundNumber);
    }

    const template = planetTemplates[(roundNumber - 1) % planetTemplates.length];

    return {
      roundId: `round_${roundNumber}`,
      difficulty: roundNumber,
      candidates: template.candidates,
      imposterCandidateId: template.imposterCandidateId,
      explanation: template.explanation
    };
  }

  private buildGenericRound(topic: string, roundNumber: number): RoundInternal {
    const safeTopic = topic.trim() || "this topic";

    return {
      roundId: `round_${roundNumber}`,
      difficulty: roundNumber,
      imposterCandidateId: "rabbit",
      explanation: `The Rabbit statement is incorrect for ${safeTopic}.`,
      candidates: [
        {
          id: "pig",
          animalName: "Pig",
          statement: `${safeTopic} can be studied using evidence and observation.`
        },
        {
          id: "cat",
          animalName: "Cat",
          statement: `People often learn ${safeTopic} through examples and practice.`
        },
        {
          id: "bull",
          animalName: "Bull",
          statement: `Understanding ${safeTopic} improves when you compare sources.`
        },
        {
          id: "rabbit",
          animalName: "Rabbit",
          statement: `${safeTopic} has exactly one fact and never needs verification.`
        },
        {
          id: "dog",
          animalName: "Dog",
          statement: `Asking questions is a useful way to learn about ${safeTopic}.`
        }
      ]
    };
  }
}

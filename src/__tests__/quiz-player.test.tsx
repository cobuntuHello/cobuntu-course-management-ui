/**
 * Tests — taking a quiz.
 *
 * The claims worth pinning are all about WHEN things happen, because getting
 * them wrong produces a quiz that works and teaches nothing:
 *
 *   - a question is marked the moment it is answered, not at the end;
 *   - the explanation stays on screen until the learner moves on;
 *   - checking an answer records NOTHING, so a half-finished quiz leaves no
 *     score behind;
 *   - an ungated quiz never says "passed" or "failed", because no bar was set.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "./en.json";

const getQuiz = vi.fn();
const checkQuizAnswer = vi.fn();
const submitQuizAttempt = vi.fn();

vi.mock("../lib/api-learning-quizzes", () => ({
    getQuiz: (...a: unknown[]) => getQuiz(...a),
    checkQuizAnswer: (...a: unknown[]) => checkQuizAnswer(...a),
    submitQuizAttempt: (...a: unknown[]) => submitQuizAttempt(...a),
}));

// eslint-disable-next-line import/first
import { QuizPlayer } from "../components/QuizPlayer.client";

const QUIZ = (over: Record<string, unknown> = {}) => ({
    id: "q1",
    lessonId: "l1",
    instructions: null,
    passPercent: null,
    maxAttempts: null,
    questionCount: 2,
    questions: [
        {
            id: "qq1", prompt: "Centre first, or open first?", order: 0,
            options: [
                { id: "o1", label: "Centre first", order: 0 },
                { id: "o2", label: "Open first", order: 1 },
            ],
        },
        {
            id: "qq2", prompt: "What is bone dry?", order: 1,
            options: [
                { id: "o3", label: "Ready to fire", order: 0 },
                { id: "o4", label: "Ready to glaze", order: 1 },
            ],
        },
    ],
    attempts: [],
    ...over,
});

function mount(onPassed?: () => void) {
    return render(
        <NextIntlClientProvider locale="en" messages={enMessages}>
            <QuizPlayer quizId="q1" onPassed={onPassed} />
        </NextIntlClientProvider>,
    );
}

beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    getQuiz.mockResolvedValue(QUIZ());
    checkQuizAnswer.mockResolvedValue({
        questionId: "qq1", correct: true, correctOptionId: "o1", feedback: "Uneven walls otherwise.",
    });
    submitQuizAttempt.mockResolvedValue({
        attemptId: "a1", scorePercent: 100, passed: true, correct: 2, total: 2, passPercent: null,
        questions: [],
    });
});

describe("one question at a time", () => {
    it("opens on the first question, not a list of all of them", async () => {
        mount();
        await waitFor(() => expect(screen.getByText("Centre first, or open first?")).toBeTruthy());
        // The second question is not on screen yet.
        expect(screen.queryByText("What is bone dry?")).toBeNull();
        expect(screen.getByText("Question 1 of 2")).toBeTruthy();
    });

    it("marks the answer the moment it is given", async () => {
        mount();
        await waitFor(() => screen.getByText("Centre first"));
        fireEvent.click(screen.getByText("Centre first"));

        await waitFor(() => expect(checkQuizAnswer).toHaveBeenCalledWith("qq1", "o1"));
        expect(screen.getByText("That is right")).toBeTruthy();
    });

    it("shows the explanation, which is the whole point", async () => {
        mount();
        await waitFor(() => screen.getByText("Centre first"));
        fireEvent.click(screen.getByText("Open first"));
        await waitFor(() => expect(screen.getByText("Uneven walls otherwise.")).toBeTruthy());
    });

    it("waits for them rather than advancing on its own", async () => {
        /*
         * Auto-advancing would show the explanation for a third of a second and
         * then take it away, which is the same as not showing it.
         */
        mount();
        await waitFor(() => screen.getByText("Centre first"));
        fireEvent.click(screen.getByText("Centre first"));
        await waitFor(() => screen.getByText("That is right"));

        expect(screen.getByText("Question 1 of 2")).toBeTruthy();
        expect(screen.getByText("Next question")).toBeTruthy();
    });

    it("moves on when they say so", async () => {
        mount();
        await waitFor(() => screen.getByText("Centre first"));
        fireEvent.click(screen.getByText("Centre first"));
        await waitFor(() => screen.getByText("Next question"));
        fireEvent.click(screen.getByText("Next question"));

        await waitFor(() => expect(screen.getByText("What is bone dry?")).toBeTruthy());
        expect(screen.getByText("Question 2 of 2")).toBeTruthy();
    });
});

describe("checking records nothing", () => {
    it("does not submit an attempt while working through the questions", async () => {
        /*
         * The attempt is the only writer. Answering two of four questions and
         * closing the tab must leave no score for a paper nobody handed in.
         */
        mount();
        await waitFor(() => screen.getByText("Centre first"));
        fireEvent.click(screen.getByText("Centre first"));
        await waitFor(() => screen.getByText("Next question"));
        fireEvent.click(screen.getByText("Next question"));
        await waitFor(() => screen.getByText("What is bone dry?"));

        expect(submitQuizAttempt).not.toHaveBeenCalled();
    });

    it("submits once, at the end, with every answer", async () => {
        mount();
        await waitFor(() => screen.getByText("Centre first"));
        fireEvent.click(screen.getByText("Centre first"));
        await waitFor(() => screen.getByText("Next question"));
        fireEvent.click(screen.getByText("Next question"));

        await waitFor(() => screen.getByText("Ready to fire"));
        fireEvent.click(screen.getByText("Ready to fire"));
        await waitFor(() => screen.getByText("See how you did"));
        fireEvent.click(screen.getByText("See how you did"));

        await waitFor(() => expect(submitQuizAttempt).toHaveBeenCalledTimes(1));
        expect(submitQuizAttempt).toHaveBeenCalledWith("q1", { qq1: "o1", qq2: "o3" });
    });
});

describe("skipping", () => {
    it("is offered, because a knowledge check must not be a wall", async () => {
        mount();
        await waitFor(() => expect(screen.getByText("Skip this one")).toBeTruthy());
    });

    it("counts as an answer of none, and still marks the question", async () => {
        checkQuizAnswer.mockResolvedValue({
            questionId: "qq1", correct: false, correctOptionId: "o1", feedback: null,
        });
        mount();
        await waitFor(() => screen.getByText("Skip this one"));
        fireEvent.click(screen.getByText("Skip this one"));

        await waitFor(() => expect(checkQuizAnswer).toHaveBeenCalledWith("qq1", null));
        expect(screen.getByText("Not quite")).toBeTruthy();
    });

    it("stops being offered once the question is marked", async () => {
        // "Skip" after seeing the answer is not a skip.
        mount();
        await waitFor(() => screen.getByText("Centre first"));
        fireEvent.click(screen.getByText("Centre first"));
        await waitFor(() => screen.getByText("That is right"));
        expect(screen.getByText("Skip this one").hasAttribute("hidden")).toBe(true);
    });
});

describe("when the check fails", () => {
    it("keeps the answer and carries on, losing only the explanation", async () => {
        /*
         * The score is computed server-side from the answers at the end, so a
         * failed check costs the teaching moment and nothing else. Throwing the
         * answer away would cost them the question.
         */
        checkQuizAnswer.mockRejectedValue(new Error("offline"));
        mount();
        await waitFor(() => screen.getByText("Centre first"));
        fireEvent.click(screen.getByText("Centre first"));

        await waitFor(() => expect(screen.getByText("Next question")).toBeTruthy());
        fireEvent.click(screen.getByText("Next question"));
        await waitFor(() => screen.getByText("Ready to fire"));
        fireEvent.click(screen.getByText("Ready to fire"));
        await waitFor(() => screen.getByText("See how you did"));
        fireEvent.click(screen.getByText("See how you did"));

        // The first answer is still in the paper.
        await waitFor(() => expect(submitQuizAttempt).toHaveBeenCalledWith("q1", { qq1: "o1", qq2: "o3" }));
    });
});

describe("the result", () => {
    async function finish() {
        mount();
        await waitFor(() => screen.getByText("Centre first"));
        fireEvent.click(screen.getByText("Centre first"));
        await waitFor(() => screen.getByText("Next question"));
        fireEvent.click(screen.getByText("Next question"));
        await waitFor(() => screen.getByText("Ready to fire"));
        fireEvent.click(screen.getByText("Ready to fire"));
        await waitFor(() => screen.getByText("See how you did"));
        fireEvent.click(screen.getByText("See how you did"));
    }

    it("says nothing about passing when the quiz is ungated", async () => {
        /*
         * Calling a knowledge check "passed" invents a bar the author never
         * set, which is the thing the whole ungated-by-default design exists
         * to avoid.
         */
        await finish();
        await waitFor(() => expect(screen.getByText("2 / 2")).toBeTruthy());
        expect(screen.getByText(/Nothing rides on this one/)).toBeTruthy();
        expect(screen.queryByText(/You passed/)).toBeNull();
    });

    it("names the mark and offers the way back when a gated attempt falls short", async () => {
        submitQuizAttempt.mockResolvedValue({
            attemptId: "a1", scorePercent: 50, passed: false, correct: 1, total: 2, passPercent: 70,
            questions: [],
        });
        await finish();
        await waitFor(() => expect(screen.getByText(/You need 70%/)).toBeTruthy());
        expect(screen.getByText("Try again")).toBeTruthy();
    });

    it("tells the parent when an attempt completed the lesson", async () => {
        const onPassed = vi.fn();
        mount(onPassed);
        await waitFor(() => screen.getByText("Centre first"));
        fireEvent.click(screen.getByText("Centre first"));
        await waitFor(() => screen.getByText("Next question"));
        fireEvent.click(screen.getByText("Next question"));
        await waitFor(() => screen.getByText("Ready to fire"));
        fireEvent.click(screen.getByText("Ready to fire"));
        await waitFor(() => screen.getByText("See how you did"));
        fireEvent.click(screen.getByText("See how you did"));

        await waitFor(() => expect(onPassed).toHaveBeenCalled());
    });
});

describe("a quiz somebody cannot open", () => {
    it("says so plainly rather than showing an error", async () => {
        // A 404 here is the ordinary answer for a non-buyer, not a fault.
        getQuiz.mockRejectedValue(new Error("Not found"));
        mount();
        await waitFor(() => expect(screen.getByText("This quiz is part of the course.")).toBeTruthy());
    });
});

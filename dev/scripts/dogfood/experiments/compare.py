"""EXP-38: an SDK comparison on the stack, the judge answered by llmsim through langevals.

Row 0 has three outputs and gets a verdict, row 1 has one and is skipped, and naming a
target with no output for row 0 is refused. Run it with run.sh.
"""

import truststore

truststore.inject_into_ssl()

import langwatch

ROWS = ["Name a primary colour.", "Name a planet."]


def main() -> None:
    experiment = langwatch.experiment.init("haven-sdk-comparison")
    for index, question in experiment.loop(list(enumerate(ROWS)), threads=1):
        for target in ["terse", "chatty", "formal"] if index == 0 else ["terse"]:
            with experiment.target(target):
                experiment.log_response(f"{target} answer to: {question}")

        verdict = experiment.compare(index, input=question)
        print(
            f"[compare] row {index}: {verdict.status} winner={verdict.winner} {verdict.reasoning}"
        )

        if index == 0:
            try:
                experiment.compare(index, targets=["terse", "missing"])
            except ValueError as error:
                print(f"[compare] row 0 missing target refused: {error}")


if __name__ == "__main__":
    main()

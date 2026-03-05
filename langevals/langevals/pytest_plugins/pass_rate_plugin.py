import pytest


def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        "pass_rate: allows for passing the tests even if they partially fail less than the rate, with 1.0 meaning all samples must pass, and 0.0 meaning all samples are allowed to fail.",
    )


def pytest_collection_modifyitems(session, config, items):
    session.pass_rates = {}
    for item in items:
        marker = item.get_closest_marker("pass_rate")
        if marker:
            group_name = item.nodeid.split("[")[0]
            if group_name not in session.pass_rates:
                session.pass_rates[group_name] = {
                    "total": 0,
                    "passed": set(),
                    "required_rate": marker.args[0],
                    "processed": set(),
                    "reports": {},
                }
            session.pass_rates[group_name]["total"] += 1


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    outcome = yield

    report = outcome.get_result()

    if report.when == "call":  # Only consider the call phase
        group_name = item.nodeid.split("[")[0]
        if group_name in item.session.pass_rates:
            if report.outcome == "failed":
                pass_rate_data = item.session.pass_rates[group_name]
                optimistic_pass_rate = (
                    pass_rate_data["total"]
                    - len(pass_rate_data["processed"])
                    + len(pass_rate_data["passed"])
                )
                current_rate = optimistic_pass_rate / pass_rate_data["total"]
                required_rate = pass_rate_data["required_rate"]

                # Check if the group pass rate is still acceptable
                if current_rate >= required_rate:
                    # We manipulate the report here to change its outcome
                    report.outcome = "skipped"
                    report.longrepr = (
                        f"acceptable failure (under {required_rate:.2%} pass rate)"
                    )
                    report.wasxfail = "reason: under acceptable failure rate"
            # If a retry mechanism gets the test to eventually pass, we mark it all as passed
            elif (
                report.outcome == "passed"
                and item.nodeid in item.session.pass_rates[group_name]["reports"]
            ):
                previous_reports = item.session.pass_rates[group_name]["reports"][
                    item.nodeid
                ]
                for previous_report in previous_reports:
                    if previous_report.outcome == "failed":
                        report.outcome = "passed"
                        report.longrepr = f"passed eventually"

            if item.nodeid not in item.session.pass_rates[group_name]["reports"]:
                item.session.pass_rates[group_name]["reports"][item.nodeid] = []
            item.session.pass_rates[group_name]["reports"][item.nodeid].append(report)

    report.session = item.session


def pytest_runtest_logreport(report):
    if report.when == "call":
        group_name = report.nodeid.split("[")[0]
        if group_name in report.session.pass_rates:

            report.session.pass_rates[group_name]["processed"].add(report.nodeid)
            if report.outcome == "passed":
                report.session.pass_rates[group_name]["passed"].add(report.nodeid)
            elif report.nodeid in report.session.pass_rates[group_name]["passed"]:
                report.session.pass_rates[group_name]["passed"].remove(report.nodeid)


def pytest_sessionfinish(session, exitstatus):
    for group_name, data in session.pass_rates.items():
        pass_rate = len(data["passed"]) / data["total"]
        required_rate = data["required_rate"]
        if pass_rate < required_rate:
            print(
                f"\n\nTest group '{group_name}' failed to meet the pass rate requirement: {pass_rate:.2%} / {required_rate:.2%} required."
            )
            session.exitstatus = 1  # Set exit status to failure if any group fails

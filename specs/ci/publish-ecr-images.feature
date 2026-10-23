Feature: Publish every deployable image to the artifacts registry
  As the team that deploys LangWatch Cloud
  I want every image built from this repository published to the artifacts registry under its commit tag
  So that the deployment pins one commit of this repository and builds nothing from its source itself

  # These scenarios describe .github/workflows/publish-docker-ecr.yml. How a
  # Lambda image gets its tag is .github/scripts/publish-lambda-tag.sh, bound
  # by .github/scripts/__tests__/publish-lambda-tag.test.sh. The path filters
  # are bound by .github/scripts/__tests__/publish-ecr-filters.test.sh, where a Lambda
  # image starts by tools/ciguard/lambdaworkdir_test.go, and the boot check a
  # Lambda image passes before it is pushed by tools/lambdaboot. The rest is the
  # workflow's own build steps, which no test suite can run: those scenarios
  # are @unimplemented and are proved by the first run on main.

  @unimplemented
  Scenario: Service images are published as an index under the commit tag
    Given a merge to main changes the source of the langy agent
    When publish-docker-ecr runs for that commit
    Then langwatch-langy-agent has a git-<short sha> tag
    And that tag is an image index over an arm64 manifest

  @unimplemented
  Scenario: Lambda images are published as a single manifest
    Given a merge to main changes the NLP engine or the evaluators
    When publish-docker-ecr runs for that commit
    Then langwatch-nlp-lambda and each langwatch-eval-<package> image has a git-<short sha> tag
    And that tag is a single arm64 manifest, because a Lambda function image cannot be an index

  @unit
  Scenario: An image the commit did not change still gets the commit tag
    Given a merge to main changes nothing the evaluator images are built from
    When publish-docker-ecr runs for that commit
    Then each langwatch-eval-<package> image gets the git-<short sha> tag of that commit
    And the tag names the manifest the image already had, with no rebuild

  @unit
  Scenario: An image the commit did not change is re-tagged only from an ancestor commit
    Given git-<sha> images of an unchanged image built from other lines of history and from older ancestors pushed later
    When publish-docker-ecr re-tags that image for a commit that did not change it, Lambda or service image alike
    Then the commit tag names the image of the nearest commit on its first-parent history, never one reached only through a merged branch

  @unit
  Scenario: A .dockerignore change rebuilds every image
    Given a merge to main changes .dockerignore
    When publish-docker-ecr selects the images to build
    Then every image is rebuilt, because every build reads the repository root as its context

  @unimplemented
  Scenario: A failed Lambda build does not hold back the service images
    Given the build of one evaluator image fails
    When publish-docker-ecr finishes for that commit
    Then the service images still have their git-<short sha> tags

  @unit
  Scenario: A Lambda image whose build did not push its tag fails the run
    Given an evaluator image was due to be built and has no git-<short sha> tag
    When publish-docker-ecr publishes that image
    Then it fails, naming the evaluator image that was not published
    And it does not fall back to an older image

  @unit
  Scenario: A Lambda image with no earlier image is left unpublished with a warning
    Given an evaluator image has no git-<sha> tag at all
    When publish-docker-ecr re-tags that image for a commit that did not change it
    Then it warns that the image needs a dispatch run to be seeded
    And it writes no tag and does not fail

  @unit
  Scenario: A tag that cannot be written fails the run
    Given the registry refuses to write the commit tag for an evaluator image
    When publish-docker-ecr re-tags that image
    Then it fails and shows the registry's error

  @unit
  Scenario: A Lambda image is never re-tagged from an index
    Given the newest git-<sha> tag of an evaluator image is an image index
    When publish-docker-ecr re-tags that image for a commit that did not change it
    Then it fails instead of writing the commit tag

  @unit
  Scenario: A release also tags each Lambda image with its version
    Given a langwatch@v<version> release
    When publish-docker-ecr publishes a Lambda image
    Then the image also gets the <version> tag, naming the same manifest

  @unit
  Scenario: A Lambda image starts in a directory Lambda's own user can enter
    Given a Lambda image whose base sets a home directory only its own user may enter
    When the image's Dockerfile is checked
    Then its runtime stage sets a working directory outside every home directory

  # The Dockerfile check above reads one known cause. The boot check runs the
  # built image the way Lambda does, as a user that is not the image's own,
  # with a read-only root and only /tmp writable, so any cause that stops it
  # starting fails the run before the image gets a tag.
  @unit
  Scenario: A Lambda image that serves its health check as a foreign user is pushed
    Given a built Lambda image that starts as a user other than its own
    When the publish run boots it before pushing
    Then its health check answers within the bound
    And the image is pushed under the commit tag

  @unit
  Scenario: A Lambda image that cannot start as a foreign user is never pushed
    Given a built Lambda image whose working directory only its own user may enter
    When the publish run boots it before pushing
    Then the run fails and names the image
    And the image gets no tag

  @unit
  Scenario: A Lambda image whose process exits during the boot check fails at once
    Given a built Lambda image whose process exits soon after it starts
    When the publish run boots it before pushing
    Then the run fails without waiting out the bound
    And the failure shows the container's own output

  @unit
  Scenario: A Lambda image that never answers its health check fails within the bound
    Given a built Lambda image that keeps running but never answers its health check
    When the publish run boots it before pushing
    Then the run fails once the bound has passed
    And the failure shows the container's own output

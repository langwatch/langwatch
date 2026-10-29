Feature: Publish every deployable image to the artifacts registry
  As the team that deploys LangWatch Cloud
  I want every image built from this repository published to the artifacts registry under its commit tag
  So that the deployment pins one commit of this repository and builds nothing from its source itself

  # These scenarios describe .github/workflows/publish-docker-ecr.yml, and the
  # last one .github/workflows/publish-docker-private.yml. How a Lambda image
  # gets its tag is cmd/ecrtag, bound by tools/ecrtag/lambda_test.go. The path filters
  # are bound by .github/scripts/__tests__/publish-ecr-filters.test.sh, and where a Lambda
  # image starts by tools/ciguard/lambdaworkdir_test.go. That a release
  # publishes nothing is bound by tools/ciguard/publishshape_test.go, and where a
  # push run's change set starts by tools/ecrtag/diffbase_test.go and
  # tools/ciguard/ecrdiffbase_test.go. The rest is the
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
  Scenario: A commit whose run was replaced while it waited still rebuilds what it changed
    Given merges B and C land while the run for an earlier merge A builds
    And the waiting run for B is replaced by the run for C, so B publishes nothing
    And B changed an image that C did not
    When publish-docker-ecr selects the images to build for C
    Then its change set starts at A, the commit whose image a re-tag of C would copy
    And that image is rebuilt for C rather than re-tagged from A's image

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
  Scenario: A release publishes nothing to the artifacts registry
    Given a langwatch@v<version> release is published
    Then publish-docker-ecr does not run
    And no git-<sha> tag LangWatch Cloud already uses is rebuilt or moved

  @unit
  Scenario: A Lambda image starts in a directory Lambda's own user can enter
    Given a Lambda image whose base sets a home directory only its own user may enter
    When the image's Dockerfile is checked
    Then its runtime stage sets a working directory outside every home directory

  # The artifacts repositories' tags are immutable, so every push checks first
  # with cmd/ecrtag. The skip decision is bound by tools/ecrtag's tests, the
  # Lambda re-tag by tools/ecrtag/lambda_test.go, and that every push is gated
  # on the check by tools/ciguard/ecrskip_test.go.

  @unit
  Scenario: A re-run publishes nothing that is already there
    Given an earlier run published the git-<short sha> tags of a commit
    When publish-docker-ecr runs again for that commit, by a re-run or by a dispatch after a run that built every image
    Then it builds, pushes and re-tags no image whose tag is already in the registry for that commit
    And every tag already there still names the image it named before
    And the run succeeds

  @unit
  Scenario: A dispatch whose custom tag is already there for another commit or none fails the run
    Given an image already has the tag a dispatcher typed as image_tag, recording another commit or none
    When publish-docker-ecr is dispatched with that image_tag
    Then it fails and asks for a new tag
    And it writes no tag to that image

  @unit
  Scenario: A re-run of a dispatch with a custom tag publishes nothing already there
    Given a dispatch with a custom image_tag published some of its images and then failed
    When that run is re-run for the same commit
    Then each image whose custom tag records that commit is left as it is
    And the images still missing the tag are published

  @unit
  Scenario: A dispatch that rebuilds an image a push run re-tagged fails the run
    Given a push run re-tagged an unchanged ancestor image as this commit's git-<short sha>
    When publish-docker-ecr is dispatched for that commit, rebuilding every image
    Then it fails for that image, saying the tag names an ancestor's image and cannot be moved
    And it does not count the tag as published

  @unit
  Scenario: A dispatch with a new custom tag over a published commit writes that tag
    Given an earlier run published the git-<short sha> tags of a commit
    When publish-docker-ecr is dispatched for that commit with an image_tag not yet in the registry
    Then it checks and writes that image_tag on every image
    And the git-<short sha> tags already there do not stop it

  @unit
  Scenario: A commit tag already there for another commit fails the run
    Given another commit sharing this commit's short sha already published git-<short sha>
    When publish-docker-ecr publishes this commit
    Then it fails, naming both commits, instead of counting the image as published
    And it writes no tag to that image

  @unit
  Scenario: A commit tag already there that records no commit fails the run
    Given git-<short sha> was published before the images recorded their commit
    And it is not exactly the image a re-tag for this commit would copy
    When publish-docker-ecr publishes this commit
    Then it fails, because it cannot tell which commit the tag was published for
    And it writes no tag to that image

  @unit
  Scenario: A lookup that does not answer whether a tag is there fails the run
    Given the registry answers a tag lookup with an error other than "image not found"
    When publish-docker-ecr checks whether a tag is already published
    Then it fails and shows the registry's error
    And it writes no tag to that image

  @unit
  Scenario: A tag that already names another image fails the run
    Given the commit tag of an evaluator image appears between the check and the write, naming another image
    When publish-docker-ecr re-tags that image
    Then it fails, saying the tag cannot be moved, instead of counting the image as published

  @unit
  Scenario: A private build reuses a tag only for the commit it records
    Given publish-docker-private already published langwatch-app under a tag
    When it is dispatched again
    Then with a tag recording that commit it skips the build and succeeds
    And with a tag recording another commit, or none, it fails and asks for a new tag

# Setting up the project

To install all the dependencies with poetry, run:

```
make install
```

## VSCode

Poetry creates a virtualenv where it install all dependencies. If you are using VSCode, you will need to set the Python Interpreter on VSCode to the one from poetry. To find the path for it, run:

```
poetry show -v
```

Then add the interpreter path to be the virtualenv path + `/bin/python` e.g.:

# Tests

You can run tests with

```
make test
```

# Running examples

```
cd examples
poetry run chainlit run openai_bot.py -w
```
# ThreadMine Hung Test Diagnosis

A test hangs in CI, the job hits `timeout-minutes`, and all you get is "The job has exceeded the
maximum execution time". This action dumps the stuck test JVM at that moment, sends the thread dump
to [ThreadMine](https://threadmine.dev) and writes the diagnosis to the job summary and to the pull
request: which threads are stuck, on which lock, and where in your code.

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    permissions:
      contents: read
      pull-requests: write   # optional: without it you get the job summary only
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with: { distribution: temurin, java-version: 21 }
      - uses: maschiojv/threadmine-action@v1   # before the test step
      - run: ./mvnw -B verify
```

No account, no API key, no change to your build. Works with Maven (Surefire and Failsafe) and
Gradle, on Linux and macOS runners.

## Privacy

The action only does something when the job fails or times out **and** a test JVM is still alive,
or Surefire left a timeout dump. A plain test failure sends nothing.

When it does, the thread dumps go to threadmine.dev for analysis. They are also kept as a workflow
artifact. The repository name is not sent. Reports made without an account expire after 7 days.
Set `analyze: false` to keep the dumps only in the artifact and send nothing.

## Inputs

| Input | Default | What it does |
|---|---|---|
| `analyze` | `true` | Send the dumps to threadmine.dev. With `false`, dumps are only uploaded as an artifact. |
| `comment` | `true` | Post the diagnosis on the pull request. Needs `pull-requests: write`. |
| `github-token` | `${{ github.token }}` | Token used for the pull request comment. |

## How it works

When a job or a step times out, the runner kills the step's shell, but the JVMs started by the
build keep running until the job's final cleanup. The action's post step runs before that cleanup,
so it finds the test JVMs that are still alive (Surefire forks or Gradle test workers) with
`jcmd -l` and dumps them with `jcmd <pid> Thread.print`. Build daemons and the Maven or Gradle
client are ignored, because they outlive every build.

Up to 3 dumps per job are analyzed. The rest stay in the artifact. A re-run of the same job
updates its pull request comment instead of adding a new one.

`jcmd` comes from `JAVA_HOME`, so run `actions/setup-java` before this action.

## Optional: Surefire timeout dumps

If you use Surefire's own fork timeout, Surefire kills the fork before the post step runs. Since
Surefire 3.6.0 it can write a jstack dump right before the kill, and this action picks it up:

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-surefire-plugin</artifactId>
  <version>3.6.1</version>
  <configuration>
    <forkedProcessTimeoutInSeconds>600</forkedProcessTimeoutInSeconds>
    <forkedProcessTimeoutExtensionContext>
      <jstack.enabled>true</jstack.enabled>
    </forkedProcessTimeoutExtensionContext>
  </configuration>
</plugin>
```

## Limits

- Analyses without an account are limited to 5 per hour per IP. GitHub-hosted runners share IPs,
  so a busy hour can hit the limit. The dumps still land in the artifact, and the summary says why
  the analysis was skipped.
- Pull requests from forks get a read-only token, so there is no comment. The job summary still
  has the diagnosis.
- Windows runners are not supported yet.
- The action never fails your job. Its own errors show up as warnings.

## License

MIT

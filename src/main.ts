import * as core from '@actions/core'

// All the work happens in the post step: when the job fails or times out, the runner has killed
// only the step's shell, and the hung test JVMs are still alive to be dumped.
core.saveState('started', String(Date.now()))
core.info('ThreadMine: if this job fails or times out, hung test JVMs will be dumped and diagnosed.')

/**
 * An object used for passing data by (mutable) reference.
 *
 * Useful for storing scalar data types in locks.
 *
 * @typeParam T the type to store
 */
export class Ref<T> {
	value: T

	/**
	 * Creates a Ref object
	 */
	constructor(value: T) {
		this.value = value
	}

	/**
	 * Returns the referenced value
	 */
	getValue(): T {
		return this.value
	}

	/**
	 * Sets the referenced value
	 */
	setValue(value: T): this {
		this.value = value
		return this
	}
}

/**
 * An mutually-exclusive lock.
 *
 * Only one accessor can use the underlying value through the Mutex
 * simultaneously.
 *
 * If another call to {@link Mutex.run} occurs
 * when the previous async function has not resolved yet,
 * the next new async function is scheduled to run immediately after the previous resolves.
 *
 * Note that JavaScript is single-threaded,
 * and all values are automatically locked if functions are not async (do not have break points).
 *
 * A mutex can be used without an underlying value (i.e. `undefined`/`null`),
 * but if the mutex is to prevent concurrent modification of some value,
 * it is cleaner to store this value inside the mutex.
 * However, storing scalar values directly would not allow modification.
 * Wrap scalar values with `Ref` if it is intended to be modified.
 *
 * @typeParam T the underlying value
 */
export class Mutex<T> {
	private readonly value: T
	private running: boolean = false
	private queue: Runnable[] = []

	/**
	 * Initializes a mutex with the underlying value.
	 */
	constructor(value: T) {
		this.value = value
	}

	/**
	 * Schedules an async function to be executed
	 * when the mutex is free.
	 *
	 * Note that the passed `handler` should not leak the underlying value
	 * to another context that outlives the async function,
	 * otherwise it defeats the point of using a mutex.
	 *
	 * @param handler the async function accepting the underlying value
	 * @return the value returned by the async function
	 *
	 * @typeParam R the return type of the async function
	 */
	run<R>(handler: (value: T) => Promise<R>): Promise<R> {
		return new Promise((resolve, reject) => {
			this.queue.push(() => {
				handler(this.value)
					.then(ret => {
						resolve(ret)
						this.running = false
						this.next()
					})
					.catch(err => {
						reject(err)
						this.running = false
						this.next()
					})
			})

			if(!this.running) {
				this.next()
			}
		})
	}

	private next() {
		if(this.running) {
			throw "call to next() while still running"
		}

		const fx = this.queue.shift()
		if(fx !== undefined) {
			this.running = true
			fx()
		}
	}

	/**
	 * Returns true if the mutex is currently unused, false if the mutex is currently locked.
	 */
	isIdle(): boolean {
		return !this.running
	}

	/**
	 * Returns the number of async functions that the mutex is scheduled to run,
	 * excluding the currently executing one.
	 */
	getQueueLength(): number {
		return this.queue.length
	}
}

/**
 * A shared lock.
 *
 * `RwLock` allows two types of locking: "read" (shared) and "write" (exclusive).
 * Write operations are similar to mutex locks,
 * while read operations can take place simultaneously with other read operations.
 *
 * `RwLock` implements a fair lock mechanism:
 * - If the lock is currently executing read operations
 * and there are no pending write operations,
 * a new read operation gets executed immediately.
 * - If the lock is currently executing a write operation,
 * a new read operation gets executed after the write operation completes.
 * - A new write operation always waits for the current operation to complete
 * before executing.
 */
export class RwLock<T> {
	private readonly value: T
	private readonly mutex: Mutex<null>
	private remaining: number = 0
	private tailFxList: AsyncRunnable[] | null = null
	private batchDone: Runnable | null = null

	/**
	 * Initializes a RwLock with the underlying value.
	 */
	constructor(value: T) {
		this.value = value
		this.mutex = new Mutex(null)
	}

	/**
	 * Schedules a write operation.
	 */
	write<R>(handler: (write: T) => Promise<R>): Promise<R> {
		this.tailFxList = null
		return this.mutex.run(async () => {
			return await handler(this.value)
		})
	}

	/**
	 * Schedules a read operation.
	 *
	 * The promise resolves as soon as the `handler` async function resolves.
	 * It does not wait for other read operations executing simultanouelsy to complete first.
	 */
	read<R>(handler: (read: T) => Promise<R>): Promise<R> {
		return new Promise((resolve, reject) => {
			const vvvHandler = async () => {
				try {
					resolve(await handler(this.value))
				} catch(err) {
					reject(err)
				}
			}

			if(this.tailFxList === null) {
				// mutex is either idle or running something with a write batch tail, need to schedule new batch

				const fxList = [vvvHandler]
				this.tailFxList = fxList
				this.mutex.run(() => new Promise(batchDone => {
					this.batchDone = batchDone
					this.remaining = fxList.length

					for(const fx of fxList) {
						fx().then(() => {
							// fx should be a void-in void-out void-err function
							this.remaining--
							if(this.remaining === 0) {
								if(this.tailFxList === fxList) {
									this.tailFxList = null
								}
								if(this.batchDone === null) {
									throw "batchDone() should be set during mutex lock by read batch"
								}
								this.batchDone()
							}
						})
					}
				}))
			} else {
				// mutex is running and tail is read batch tail
				// two cases: tail is running or tail is in queue
				if(this.mutex.getQueueLength() > 0) {
					// tail is in queue
					this.tailFxList.push(vvvHandler)
				} else {
					// tail is running
					this.remaining++
					const fxList = this.tailFxList
					vvvHandler()
						.then(() => {
							this.remaining--
							if(this.remaining === 0) {
								if(this.tailFxList === fxList) {
									// no write operations were appended while handler was being executed
									this.tailFxList = null
								}

								if(this.batchDone === null) {
									throw "batchDone() should be set during mutex lock by read batch"
								}
								this.batchDone()
							}
						})
				}
			}
		})
	}
}

type Runnable = () => void
type AsyncRunnable = () => Promise<void>

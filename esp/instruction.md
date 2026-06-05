***Instruction to write source code for esp32 operating servo (door) and led screen***
- Define the self MAC address and then use it to subcribe to IoT topic for receiving commands, which define in the lambda function.
- In this flow action, esp32 door need to receive a few certification to connect to the ioT core. I will provide these into the esp32 via file system.
- After connecting to wifi and iot core, esp32 door need to subscribe continously to the topic to receive command.
- Each command will contain information about authorizated/unauthorizated face, and message (ex: many face, non-live face, no face) and will display to the led screen. After receiving the command, the door will open or close by using servo motor.
- Moreover, you must handle the error cases, such as wifi disconnected, mqtt disconnected, logs in serial monitor.

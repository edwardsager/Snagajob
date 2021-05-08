export NODE_VERSION=16.1.0
export NODE_ROOT=/home/PL/NodeJS/node-v${NODE_VERSION}-linux-x64
export NODE_PATH=$NODE_ROOT/lib/node_modules:./
export PATH=$NODE_ROOT/bin:$PATH
echo $PATH
env | grep NODE

export TIMESTAMP=`date '+%Y.%m.%d.%H.%M'`

node server.01.js

### Google AppEngine ###

## Testing ##

To run the application on your local server (http://localhost:8000):

$ <path-to-Python-SDK>/dev_appserver.py <file-dir>/

where <file-dir> is the directory containing the app.yaml file.

On Mac, <path-to-Python-SDK> is /usr/local/google-appengine/

## Uploading the Application ##

NOTE: This is for releases only.

$ <path-to-Python-SDK>/appcfg.py -A risk-4920 update guestbook/

### Bitbucket and Source Control ###

Release branch                        _release1_
                                     /     |
                                    /      bugfix/patch
Master branch  ____________________/_______|_____
                   \             /
                    \           /
Working/sprint       \_sprint1_/
branch
